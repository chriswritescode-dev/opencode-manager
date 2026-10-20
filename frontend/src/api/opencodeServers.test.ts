import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOpenCodeServer,
  deleteOpenCodeServer,
  listOpenCodeServers,
  testOpenCodeServer,
  testOpenCodeServerById,
  updateOpenCodeServer,
} from './opencodeServers'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const server = {
  id: 'srv_1',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const testResult = { ok: true, version: '2.0.15', versionSupported: true, error: null }

describe('opencodeServers', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists servers from the { servers } envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ servers: [server] }))

    await expect(listOpenCodeServers()).resolves.toEqual([server])
    expect(fetchMock.mock.calls[0][0]).toEqual(expect.stringContaining('/api/opencode-servers'))
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
  })

  it('creates a server and returns the test result', async () => {
    const input = {
      name: 'Kitchen',
      baseUrl: 'https://kitchen.example.com',
      username: 'opencode',
      password: 'secret',
      enabled: true,
    }
    fetchMock.mockResolvedValue(jsonResponse({ server, test: testResult }, 201))

    await expect(createOpenCodeServer(input)).resolves.toEqual({ server, test: testResult })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toEqual(expect.stringContaining('/api/opencode-servers'))
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual(input)
  })

  it('unwraps the { server } envelope on PATCH', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ server: { ...server, name: 'Office' } }))

    await expect(updateOpenCodeServer('srv_1', { name: 'Office' })).resolves.toEqual({
      ...server,
      name: 'Office',
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toEqual(expect.stringContaining('/api/opencode-servers/srv_1'))
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ name: 'Office' })
  })

  it('clears a password by sending null', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ server: { ...server, hasPassword: false } }))

    await updateOpenCodeServer('srv_1', { password: null })

    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ password: null })
  })

  it('deletes a server with DELETE and accepts the empty 204 response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteOpenCodeServer('srv_1')).resolves.toBeUndefined()

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toEqual(expect.stringContaining('/api/opencode-servers/srv_1'))
    expect(options.method).toBe('DELETE')
  })

  it('tests unsaved values with POST /test', async () => {
    fetchMock.mockResolvedValue(jsonResponse(testResult))
    const input = { baseUrl: 'https://kitchen.example.com', username: 'opencode', password: 'secret' }

    await expect(testOpenCodeServer(input)).resolves.toEqual(testResult)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toEqual(expect.stringContaining('/api/opencode-servers/test'))
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual(input)
  })

  it('tests a saved server with POST /:id/test', async () => {
    fetchMock.mockResolvedValue(jsonResponse(testResult))

    await expect(testOpenCodeServerById('srv_1')).resolves.toEqual(testResult)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toEqual(expect.stringContaining('/api/opencode-servers/srv_1/test'))
    expect(options.method).toBe('POST')
  })

  it('surfaces backend error messages', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Server unreachable' }, 502))

    await expect(testOpenCodeServerById('srv_1')).rejects.toThrow('Server unreachable')
  })
})
