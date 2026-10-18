import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenCodeServerRoutes } from '../../src/routes/opencode-servers'
import {
  OpenCodeServerNotFoundError,
  OpenCodeServerPairingError,
  type OpenCodeServerRegistry,
} from '../../src/services/opencode-server-registry'

const SERVER = {
  id: 'srv_1',
  name: 'Studio',
  baseUrl: 'https://studio.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 1,
}

const TEST_RESULT = { ok: true, version: '2.0.15', versionSupported: true, error: null }

describe('opencode server routes', () => {
  const registry = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    test: vi.fn(),
  }
  let app: ReturnType<typeof createOpenCodeServerRoutes>

  beforeEach(() => {
    vi.clearAllMocks()
    registry.list.mockReturnValue([])
    registry.get.mockReturnValue(null)
    app = createOpenCodeServerRoutes(registry as unknown as OpenCodeServerRegistry)
  })

  it('lists servers', async () => {
    registry.list.mockReturnValue([SERVER])

    const response = await app.request('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ servers: [SERVER] })
  })

  it('returns 404 for an unknown server id', async () => {
    const response = await app.request('/srv_missing')

    expect(response.status).toBe(404)
  })

  it('returns the server for a known id', async () => {
    registry.get.mockReturnValue(SERVER)

    const response = await app.request('/srv_1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ server: SERVER })
  })

  it('returns 400 for an invalid create body', async () => {
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Studio' }),
    })

    expect(response.status).toBe(400)
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid draft test body', async () => {
    const response = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'ftp://studio.example.com' }),
    })

    expect(response.status).toBe(400)
  })

  it('returns 400 for an invalid update body', async () => {
    const response = await app.request('/srv_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(response.status).toBe(400)
    expect(registry.update).not.toHaveBeenCalled()
  })

  it('creates a server and returns its test result', async () => {
    registry.create.mockResolvedValue(SERVER)
    registry.test.mockResolvedValue(TEST_RESULT)

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Studio', baseUrl: 'https://studio.example.com', password: 'super-secret' }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ server: SERVER, test: TEST_RESULT })
    expect(registry.test).toHaveBeenCalledWith({ serverId: 'srv_1' })
  })

  it('returns 502 when pairing fails', async () => {
    registry.create.mockRejectedValue(new OpenCodeServerPairingError('Pairing was rejected with status 403'))

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Studio',
        baseUrl: 'https://studio.example.com',
        pairing: { pairUrl: 'https://studio.example.com/pair', code: '0123456789abcdef' },
      }),
    })

    expect(response.status).toBe(502)
  })

  it('updates a server', async () => {
    registry.update.mockResolvedValue({ ...SERVER, name: 'Renamed' })

    const response = await app.request('/srv_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })

    expect(response.status).toBe(200)
    expect(registry.update).toHaveBeenCalledWith('srv_1', { name: 'Renamed' })
  })

  it('returns 404 when updating an unknown server', async () => {
    registry.update.mockRejectedValue(new OpenCodeServerNotFoundError('srv_missing'))

    const response = await app.request('/srv_missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })

    expect(response.status).toBe(404)
  })

  it('deletes a server', async () => {
    const response = await app.request('/srv_1', { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(registry.delete).toHaveBeenCalledWith('srv_1')
  })

  it('returns 404 when deleting an unknown server', async () => {
    registry.delete.mockImplementation(() => {
      throw new OpenCodeServerNotFoundError('srv_missing')
    })

    const response = await app.request('/srv_missing', { method: 'DELETE' })

    expect(response.status).toBe(404)
  })

  it('tests a stored server', async () => {
    registry.test.mockResolvedValue(TEST_RESULT)

    const response = await app.request('/srv_1/test', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(TEST_RESULT)
    expect(registry.test).toHaveBeenCalledWith({ serverId: 'srv_1' })
  })

  it('tests a draft server', async () => {
    registry.test.mockResolvedValue(TEST_RESULT)

    const response = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://studio.example.com' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(TEST_RESULT)
    expect(registry.test).toHaveBeenCalledWith({ baseUrl: 'https://studio.example.com', username: 'opencode' })
  })

  it('returns the remote event statuses from the provider', async () => {
    const statuses = [{ serverId: 'srv_1', connected: true, version: '2.0.15', error: null }]
    const statusApp = createOpenCodeServerRoutes(
      registry as unknown as OpenCodeServerRegistry,
      () => statuses,
    )

    const response = await statusApp.request('/status')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ statuses })
  })

  it('returns an empty status list when no provider is configured', async () => {
    const response = await app.request('/status')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ statuses: [] })
    expect(registry.get).not.toHaveBeenCalled()
  })
})
