import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import type { ServerResponse } from 'node:http'
import { z } from 'zod'
import { createInternalTokenMiddleware } from '../../src/auth/internal-token-middleware'
import { createOpenCodeServerProxyRoutes } from '../../src/routes/opencode-server-proxy'
import { OpenCodeServerRegistry } from '../../src/services/opencode-server-registry'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createTestDatabase, seedOpenCodeServer } from '../helpers/test-database'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { startHttpUpstream, type HttpUpstream, type RecordedUpstreamRequest } from '../helpers/http-upstream'
import { readJson } from '../helpers/read-json'

const ErrorResponseSchema = z.object({ error: z.string() })

const STORED_PASSWORD = 'secret'

function respondOk(_request: RecordedUpstreamRequest, response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('ok')
}

describe('opencode server proxy routes', () => {
  let db: Database
  let upstream: HttpUpstream
  let registry: OpenCodeServerRegistry
  let token: string
  let serverId: string

  beforeAll(async () => {
    upstream = await startHttpUpstream()
  })

  afterAll(async () => {
    await upstream.close()
  })

  beforeEach(() => {
    db = createTestDatabase()
    upstream.requests.length = 0
    upstream.setResponder(respondOk)
    token = getOrCreateInternalToken(db)
    registry = new OpenCodeServerRegistry(db, createStubOpenCodeClient(), fetch)
    serverId = seedOpenCodeServer(db, { baseUrl: upstream.baseUrl, password: STORED_PASSWORD }).id
  })

  afterEach(() => {
    db.close()
  })

  function buildApp(upstreamHeadersTimeoutMs?: number): Hono {
    const app = new Hono()
    app.route(
      '/api/opencode/servers',
      createOpenCodeServerProxyRoutes(
        registry,
        createInternalTokenMiddleware(db),
        undefined,
        upstreamHeadersTimeoutMs,
      ),
    )
    return app
  }

  async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return buildApp().request(path, { ...init, headers })
  }

  function serverPath(path: string): string {
    return `/api/opencode/servers/${serverId}${path}`
  }

  it('forwards method, path, query, and streamed body to the upstream with registry credentials', async () => {
    const payload = JSON.stringify({ parts: [{ type: 'text', text: 'hi' }] })

    const res = await authorizedFetch(serverPath('/api/session/ses_1/message?directory=%2Fwork'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'session=cookie-value',
        host: 'manager.local',
        origin: 'https://manager.local',
        referer: 'https://manager.local/chat',
      },
      body: payload,
    })

    expect(res.status).toBe(200)
    expect(upstream.requests).toHaveLength(1)

    const [recorded] = upstream.requests
    expect(recorded?.method).toBe('POST')
    expect(recorded?.url).toBe('/api/session/ses_1/message?directory=%2Fwork')
    expect(recorded?.body).toBe(payload)
    expect(recorded?.headers.authorization).toBe(buildOpenCodeBasicAuth(STORED_PASSWORD))
    expect(recorded?.headers['content-type']).toBe('application/json')
    expect(recorded?.headers.cookie).toBeUndefined()
    expect(recorded?.headers.host).not.toBe('manager.local')
    expect(recorded?.headers.origin).toBeUndefined()
    expect(recorded?.headers.referer).toBeUndefined()
    expect(recorded?.headers['x-opencode-directory']).toBeUndefined()
  })

  it('does not add a default directory header on GET requests', async () => {
    const res = await authorizedFetch(serverPath('/api/session'), { method: 'GET' })

    expect(res.status).toBe(200)
    const [recorded] = upstream.requests
    expect(recorded?.headers['x-opencode-directory']).toBeUndefined()
    expect(recorded?.body).toBe('')
  })

  it('returns 404 for an unknown server', async () => {
    const res = await authorizedFetch('/api/opencode/servers/srv_missing/api/session')

    expect(res.status).toBe(404)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
      error: 'OpenCode server not found: srv_missing',
    })
    expect(upstream.requests).toHaveLength(0)
  })

  it('returns 404 for a disabled server', async () => {
    const disabled = seedOpenCodeServer(db, { baseUrl: upstream.baseUrl, enabled: false })

    const res = await authorizedFetch(`/api/opencode/servers/${disabled.id}/api/session`)

    expect(res.status).toBe(404)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
      error: `OpenCode server is disabled: ${disabled.id}`,
    })
    expect(upstream.requests).toHaveLength(0)
  })

  it('returns 400 for the local server', async () => {
    const res = await authorizedFetch('/api/opencode/servers/local/api/session')

    expect(res.status).toBe(400)
    expect(upstream.requests).toHaveLength(0)
  })

  it('returns 400 for encoded traversal segments', async () => {
    const res = await authorizedFetch(serverPath('/api/session%2F..%2Fsecrets'))

    expect(res.status).toBe(400)
    expect(upstream.requests).toHaveLength(0)
  })

  it('returns 400 for repeated encoded traversal that survives segment decoding', async () => {
    const res = await authorizedFetch(serverPath('/api/%25252e%25252e/config'))

    expect(res.status).toBe(400)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Invalid proxy path' })
    expect(upstream.requests).toHaveLength(0)
  })

  it('returns 400 when a prefixed base URL would be escaped by path normalization', async () => {
    const prefixed = seedOpenCodeServer(db, {
      baseUrl: `${upstream.baseUrl}/prefix`,
      password: STORED_PASSWORD,
    })

    const res = await authorizedFetch(
      `/api/opencode/servers/${prefixed.id}/api/session/%25252e%25252e/%25252e%25252e/config`,
    )

    expect(res.status).toBe(400)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Invalid proxy path' })
    expect(upstream.requests).toHaveLength(0)
  })

  it('proxies a normal API path under a prefixed base URL unchanged', async () => {
    const prefixed = seedOpenCodeServer(db, {
      baseUrl: `${upstream.baseUrl}/prefix`,
      password: STORED_PASSWORD,
    })

    const res = await authorizedFetch(`/api/opencode/servers/${prefixed.id}/api/session`)

    expect(res.status).toBe(200)
    expect(upstream.requests).toHaveLength(1)
    expect(upstream.requests[0]?.url).toBe('/prefix/api/session')
  })

  it('returns 404 for upstream paths outside /api', async () => {
    const res = await authorizedFetch(serverPath('/config'))

    expect(res.status).toBe(404)
    expect(upstream.requests).toHaveLength(0)
  })

  it('returns 502 when the upstream fetch fails', async () => {
    const unreachable = seedOpenCodeServer(db, {
      baseUrl: 'http://127.0.0.1:1',
      password: STORED_PASSWORD,
    })

    const res = await authorizedFetch(`/api/opencode/servers/${unreachable.id}/api/session`)

    expect(res.status).toBe(502)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
      error: 'Remote OpenCode server unreachable',
    })
  })

  it('returns 504 when a GET upstream does not send headers before the timeout', async () => {
    upstream.setResponder(() => undefined)

    const res = await buildApp(20).request(serverPath('/api/session'), {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(504)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
      error: 'Remote OpenCode server timed out',
    })
  })

  it.each([
    ['with a body', '/api/session/ses_1/message', { method: 'POST', body: '{}' }],
    ['without a body', '/api/session/ses_1/abort', { method: 'POST' }],
  ])('does not time out a POST %s that takes longer than the headers timeout', async (_label, path, init) => {
    upstream.setResponder((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('ok')
      }, 40)
    })

    const res = await buildApp(10).request(serverPath(path), {
      ...init,
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('keeps streaming the upstream body after headers arrive', async () => {
    upstream.setResponder((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: one\n\n')
      setTimeout(() => {
        response.write('data: two\n\n')
        response.end()
      }, 40)
    })

    const res = await buildApp(10).request(serverPath('/api/event'), {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n')
  })

  it('streams the upstream response body and drops set-cookie', async () => {
    upstream.setResponder((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'set-cookie': 'leak=1' })
      response.write('data: one\n\n')
      response.write('data: two\n\n')
      response.end()
    })

    const res = await authorizedFetch(serverPath('/api/event'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n')
  })

  it('returns a null body for bodyless upstream statuses', async () => {
    upstream.setResponder((_request, response) => {
      response.writeHead(204)
      response.end()
    })

    const res = await authorizedFetch(serverPath('/api/session/ses_1'), { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('rejects unauthenticated requests before reaching the upstream', async () => {
    const res = await buildApp().request(serverPath('/api/session'))

    expect(res.status).toBe(401)
    expect(upstream.requests).toHaveLength(0)
  })
})
