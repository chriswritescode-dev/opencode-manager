import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { createOpenCodeServerProxyRoutes } from '../../src/routes/opencode-server-proxy'
import {
  OpenCodeServerError,
  OpenCodeServerNotFoundError,
  type OpenCodeServerRegistry,
} from '../../src/services/opencode-server-registry'

const getConnectionMock = vi.hoisted(() => vi.fn())

const registry = { getConnection: getConnectionMock } as unknown as OpenCodeServerRegistry

const basicAuth = `Basic ${Buffer.from('opencode:secret').toString('base64')}`

const passThroughAuth: MiddlewareHandler = async (_c, next) => {
  await next()
}

function buildApp(
  fetchFn: typeof fetch,
  requireAuth: MiddlewareHandler = passThroughAuth,
  upstreamHeadersTimeoutMs?: number,
): Hono {
  const app = new Hono()
  app.route(
    '/api/opencode/servers',
    createOpenCodeServerProxyRoutes(registry, requireAuth, fetchFn, upstreamHeadersTimeoutMs),
  )
  return app
}

function createFetchMock(response: Response = new Response('ok', { status: 200 })) {
  return vi.fn().mockResolvedValue(response)
}

function readBody(body: RequestInit['body']): Promise<string> {
  return new Response(body as unknown as string).text()
}

describe('opencode server proxy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConnectionMock.mockReturnValue({ baseUrl: 'https://remote.example:4096', authorization: basicAuth })
  })

  it('forwards method, path, query, and streamed body to the upstream with registry credentials', async () => {
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)
    const payload = JSON.stringify({ parts: [{ type: 'text', text: 'hi' }] })

    const res = await app.request('/api/opencode/servers/srv_1/api/session/ses_1/message?directory=%2Fwork', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'session=cookie-value',
        host: 'manager.local',
        authorization: 'Bearer client-token',
        origin: 'https://manager.local',
        referer: 'https://manager.local/chat',
      },
      body: payload,
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://remote.example:4096/api/session/ses_1/message?directory=%2Fwork')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(await readBody(init.body)).toBe(payload)

    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(basicAuth)
    expect(headers['content-type']).toBe('application/json')
    const headerNames = Object.keys(headers).map((name) => name.toLowerCase())
    expect(headerNames).not.toContain('cookie')
    expect(headerNames).not.toContain('host')
    expect(headerNames).not.toContain('origin')
    expect(headerNames).not.toContain('referer')
    expect(headerNames).not.toContain('x-opencode-directory')
    expect(headerNames.filter((name) => name === 'authorization')).toHaveLength(1)
  })

  it('does not add a default directory header on GET requests', async () => {
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    await app.request('/api/opencode/servers/srv_1/api/session', { method: 'GET' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('x-opencode-directory')
    expect(init.body).toBeUndefined()
  })

  it('returns 404 for an unknown server', async () => {
    getConnectionMock.mockImplementation(() => {
      throw new OpenCodeServerNotFoundError('srv_missing')
    })
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_missing/api/session')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'OpenCode server not found: srv_missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 for a disabled server', async () => {
    getConnectionMock.mockImplementation(() => {
      throw new OpenCodeServerNotFoundError('srv_off', 'disabled')
    })
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_off/api/session')

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for the local server', async () => {
    getConnectionMock.mockImplementation(() => {
      throw new OpenCodeServerError('The local OpenCode server has no remote connection', 400)
    })
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/local/api/session')

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for encoded traversal segments', async () => {
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_1/api/session%2F..%2Fsecrets')

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for repeated encoded traversal that survives segment decoding', async () => {
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_1/api/%25252e%25252e/config')

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid proxy path' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when a prefixed base URL would be escaped by path normalization', async () => {
    getConnectionMock.mockReturnValue({ baseUrl: 'http://remote.example:4096/prefix', authorization: basicAuth })
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request(
      '/api/opencode/servers/srv_1/api/session/%25252e%25252e/%25252e%25252e/config',
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid proxy path' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies a normal API path under a prefixed base URL unchanged', async () => {
    getConnectionMock.mockReturnValue({ baseUrl: 'http://remote.example:4096/prefix', authorization: basicAuth })
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_1/api/session')

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://remote.example:4096/prefix/api/session')
  })

  it('returns 404 for upstream paths outside /api', async () => {
    const fetchMock = createFetchMock()
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_1/config')

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 502 when the upstream fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_1/api/session')

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Remote OpenCode server unreachable' })
  })

  it('returns 504 when a GET upstream does not send headers before the timeout', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    }))
    const app = buildApp(fetchMock as unknown as typeof fetch, passThroughAuth, 20)

    const res = await app.request('/api/opencode/servers/srv_1/api/session')

    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'Remote OpenCode server timed out' })
  })

  it('does not time out a POST that takes longer than the headers timeout', async () => {
    let receivedSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      receivedSignal = init.signal
      await new Promise((resolve) => setTimeout(resolve, 40))
      return new Response('ok', { status: 200 })
    })
    const app = buildApp(fetchMock as unknown as typeof fetch, passThroughAuth, 10)

    const res = await app.request('/api/opencode/servers/srv_1/api/session/ses_1/message', {
      method: 'POST',
      body: '{}',
    })

    expect(res.status).toBe(200)
    expect(receivedSignal?.aborted).toBe(false)
  })

  it('keeps streaming the upstream body after headers arrive', async () => {
    const encoder = new TextEncoder()
    let receivedSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      receivedSignal = init.signal
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode('data: one\n\n'))
          await new Promise((resolve) => setTimeout(resolve, 40))
          controller.enqueue(encoder.encode('data: two\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })
    const app = buildApp(fetchMock as unknown as typeof fetch, passThroughAuth, 10)

    const res = await app.request('/api/opencode/servers/srv_1/api/event')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n')
    expect(receivedSignal?.aborted).toBe(false)
  })

  it('streams the upstream response body and drops set-cookie', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: one\n\n'))
        controller.enqueue(encoder.encode('data: two\n\n'))
        controller.close()
      },
    })
    const fetchMock = createFetchMock(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'set-cookie': 'leak=1' },
    }))
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_1/api/event')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n')
  })

  it('returns a null body for bodyless upstream statuses', async () => {
    const fetchMock = createFetchMock(new Response(null, { status: 204 }))
    const app = buildApp(fetchMock as unknown as typeof fetch)

    const res = await app.request('/api/opencode/servers/srv_1/api/session/ses_1', { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('rejects unauthenticated requests before reaching the upstream', async () => {
    const fetchMock = createFetchMock()
    const denyAuth: MiddlewareHandler = async (c) => c.json({ error: 'Unauthorized' }, 401)
    const app = buildApp(fetchMock as unknown as typeof fetch, denyAuth)

    const res = await app.request('/api/opencode/servers/srv_1/api/session')

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getConnectionMock).not.toHaveBeenCalled()
  })
})
