import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import {
  OpenCodeServerSchema,
  OpenCodeServerStatusSchema,
  OpenCodeServerTestResultSchema,
  type OpenCodeServerStatus,
  type TestOpenCodeServerRequest,
  type UpdateOpenCodeServerRequest,
} from '@opencode-manager/shared/schemas'
import { OPENCODE_MIN_VERSION } from '@opencode-manager/shared/opencode'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import { createOpenCodeServerRoutes } from '../../src/routes/opencode-servers'
import { OpenCodeServerRegistry } from '../../src/services/opencode-server-registry'
import { createTestDatabase, seedOpenCodeServer } from '../helpers/test-database'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createFetchStub, type FetchStub } from '../helpers/fetch-stub'
import { readJson } from '../helpers/read-json'

const ErrorResponseSchema = z.object({ error: z.string() })
const ServerListResponseSchema = z.object({ servers: z.array(OpenCodeServerSchema) })
const ServerResponseSchema = z.object({ server: OpenCodeServerSchema })
const CreatedServerResponseSchema = z.object({ server: OpenCodeServerSchema, test: OpenCodeServerTestResultSchema })
const StatusesResponseSchema = z.object({ statuses: z.array(OpenCodeServerStatusSchema) })

const SERVER_BASE_URL = 'https://studio.example.com'
const STORED_PASSWORD = 'stored-password'

function infoResponse(version = OPENCODE_MIN_VERSION): Response {
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('opencode server routes', () => {
  let db: Database
  let registry: OpenCodeServerRegistry
  let fetchMock: FetchStub
  let app: Hono
  let statusProvider: () => OpenCodeServerStatus[]

  beforeEach(() => {
    db = createTestDatabase()
    fetchMock = createFetchStub(async () => infoResponse())
    statusProvider = () => []
    registry = new OpenCodeServerRegistry(db, createStubOpenCodeClient(), fetchMock)
    app = new Hono()
    app.route('/', createOpenCodeServerRoutes(registry, () => statusProvider()))
  })

  afterEach(() => {
    db.close()
  })

  const patch = (path: string, body: UpdateOpenCodeServerRequest) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const createServer = (body: JsonValue) =>
    app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const testServer = (body: TestOpenCodeServerRequest) =>
    app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('lists servers', async () => {
    const server = seedOpenCodeServer(db, { name: 'Studio', baseUrl: SERVER_BASE_URL })

    const response = await app.request('/')

    expect(response.status).toBe(200)
    const body = await readJson(response, ServerListResponseSchema)
    expect(body.servers).toEqual([server])
  })

  it('returns 404 for an unknown server id', async () => {
    const response = await app.request('/srv_missing')

    expect(response.status).toBe(404)
  })

  it('returns the server for a known id', async () => {
    const server = seedOpenCodeServer(db, { name: 'Studio', baseUrl: SERVER_BASE_URL })

    const response = await app.request(`/${server.id}`)

    expect(response.status).toBe(200)
    const body = await readJson(response, ServerResponseSchema)
    expect(body.server).toEqual(server)
  })

  it('returns 400 for an invalid create body', async () => {
    const response = await createServer({ name: 'Studio' })

    expect(response.status).toBe(400)
    expect(registry.list()).toEqual([])
  })

  it('returns 400 for an invalid draft test body', async () => {
    const response = await testServer({ baseUrl: 'ftp://studio.example.com' })

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid update body', async () => {
    const server = seedOpenCodeServer(db, { name: 'Studio', baseUrl: SERVER_BASE_URL })

    const response = await patch(`/${server.id}`, { name: '' })

    expect(response.status).toBe(400)
    expect(registry.get(server.id)?.name).toBe('Studio')
  })

  it('creates a server and returns its test result', async () => {
    const response = await createServer({
      name: 'Studio',
      baseUrl: SERVER_BASE_URL,
      password: 'super-secret',
    })

    expect(response.status).toBe(201)
    const body = await readJson(response, CreatedServerResponseSchema)
    expect(body.server).toMatchObject({
      name: 'Studio',
      baseUrl: SERVER_BASE_URL,
      username: 'opencode',
      enabled: true,
      hasPassword: true,
    })
    expect(body.test).toEqual({ ok: true, version: OPENCODE_MIN_VERSION, versionSupported: true, error: null })
    expect(registry.list()).toEqual([body.server])
  })

  it('returns 502 when pairing fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      expect(String(input)).toBe(`${SERVER_BASE_URL}/pair`)
      return new Response(null, { status: 403 })
    })

    const response = await createServer({
      name: 'Studio',
      baseUrl: SERVER_BASE_URL,
      pairing: { pairUrl: `${SERVER_BASE_URL}/pair`, code: '0123456789abcdef' },
    })

    expect(response.status).toBe(502)
    expect(registry.list()).toEqual([])
  })

  it('updates a server', async () => {
    const server = seedOpenCodeServer(db, { name: 'Studio', baseUrl: SERVER_BASE_URL })

    const response = await patch(`/${server.id}`, { name: 'Renamed' })

    expect(response.status).toBe(200)
    const body = await readJson(response, ServerResponseSchema)
    expect(body.server).toMatchObject({ id: server.id, name: 'Renamed' })
    expect(registry.get(server.id)?.name).toBe('Renamed')
  })

  it('returns 400 when an origin change would reuse the stored password', async () => {
    const server = seedOpenCodeServer(db, { baseUrl: SERVER_BASE_URL, password: STORED_PASSWORD })

    const response = await patch(`/${server.id}`, { baseUrl: 'https://other-host.example.com' })

    expect(response.status).toBe(400)
    await expect(readJson(response, ErrorResponseSchema)).resolves.toEqual({
      error: 'Changing the server address requires re-entering the password or pairing again',
    })
    expect(registry.get(server.id)?.baseUrl).toBe(SERVER_BASE_URL)
  })

  it('returns 404 when updating an unknown server', async () => {
    const response = await patch('/srv_missing', { name: 'Renamed' })

    expect(response.status).toBe(404)
  })

  it('deletes a server', async () => {
    const server = seedOpenCodeServer(db, { baseUrl: SERVER_BASE_URL })

    const response = await app.request(`/${server.id}`, { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(registry.list()).toEqual([])
  })

  it('returns 404 when deleting an unknown server', async () => {
    const response = await app.request('/srv_missing', { method: 'DELETE' })

    expect(response.status).toBe(404)
  })

  it('tests a stored server', async () => {
    const server = seedOpenCodeServer(db, { baseUrl: SERVER_BASE_URL, password: STORED_PASSWORD })

    const response = await app.request(`/${server.id}/test`, { method: 'POST' })

    expect(response.status).toBe(200)
    await expect(readJson(response, OpenCodeServerTestResultSchema)).resolves.toEqual({
      ok: true,
      version: OPENCODE_MIN_VERSION,
      versionSupported: true,
      error: null,
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(`${SERVER_BASE_URL}/api/info`)
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`opencode:${STORED_PASSWORD}`).toString('base64')}`,
    )
  })

  it('tests a draft server without credentials', async () => {
    const response = await testServer({ baseUrl: SERVER_BASE_URL })

    expect(response.status).toBe(200)
    await expect(readJson(response, OpenCodeServerTestResultSchema)).resolves.toEqual({
      ok: true,
      version: OPENCODE_MIN_VERSION,
      versionSupported: true,
      error: null,
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(`${SERVER_BASE_URL}/api/info`)
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
  })

  it('tests a draft server against a saved server id', async () => {
    const server = seedOpenCodeServer(db, { baseUrl: SERVER_BASE_URL, password: STORED_PASSWORD })

    const response = await testServer({ baseUrl: `${SERVER_BASE_URL}/opencode`, serverId: server.id })

    expect(response.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(`${SERVER_BASE_URL}/opencode/api/info`)
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`opencode:${STORED_PASSWORD}`).toString('base64')}`,
    )
  })

  it('returns 404 when testing a draft against an unknown server id', async () => {
    const response = await testServer({ baseUrl: SERVER_BASE_URL, serverId: 'srv_missing' })

    expect(response.status).toBe(404)
    await expect(readJson(response, ErrorResponseSchema)).resolves.toEqual({
      error: 'OpenCode server not found: srv_missing',
    })
  })

  it('returns the remote event statuses from the provider', async () => {
    statusProvider = () => [{ serverId: 'srv_1', connected: true, version: '2.0.15', error: null }]

    const response = await app.request('/status')

    expect(response.status).toBe(200)
    const body = await readJson(response, StatusesResponseSchema)
    expect(body.statuses).toEqual([{ serverId: 'srv_1', connected: true, version: '2.0.15', error: null }])
  })
})
