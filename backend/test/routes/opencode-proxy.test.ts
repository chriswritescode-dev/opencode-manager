import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createOpenCodeProxyRoutes } from '../../src/routes/opencode-proxy'
import type { SettingsService } from '../../src/services/settings'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('../../src/services/internal-token', () => ({
  getOrCreateInternalToken: vi.fn().mockReturnValue('test-internal-token'),
}))

const mockSettingsService = {
  getOpenCodeServerPassword: vi.fn().mockReturnValue('test-password'),
} as unknown as SettingsService

const mockDb = {} as Database

describe('opencode-proxy routes', () => {
  let app: Hono
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    originalFetch = globalThis.fetch
    app = new Hono()
    app.route('/api/opencode-proxy', createOpenCodeProxyRoutes(mockDb, mockSettingsService))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns 401 without authorization header', async () => {
    const res = await app.request('/api/opencode-proxy/doc')
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 with invalid bearer token', async () => {
    const res = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 with invalid basic auth password', async () => {
    const res = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Basic ' + Buffer.from('opencode:wrong-password').toString('base64') },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 200 with valid bearer and injected Basic auth', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()

    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchUrl = fetchCall[0]
    expect(fetchUrl).toContain('http://127.0.0.1:')

    const fetchHeaders = fetchCall[1].headers as Record<string, string>
    expect(fetchHeaders['Authorization']).toMatch(/^Basic /)
    expect(fetchHeaders['Authorization']).not.toContain('Bearer')
    expect(fetchHeaders['Authorization']).toContain(
      Buffer.from('opencode:test-password').toString('base64')
    )
  })

  it('returns 200 with valid basic auth (opencode attach) and injected Basic auth', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const basicAuthHeader = 'Basic ' + Buffer.from('opencode:test-internal-token').toString('base64')
    const res = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: basicAuthHeader },
    })

    expect(res.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()

    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchHeaders = fetchCall[1].headers as Record<string, string>

    expect(fetchHeaders['Authorization']).toMatch(/^Basic /)
    expect(fetchHeaders['Authorization']).not.toContain('Bearer')
    expect(fetchHeaders['Authorization']).toContain(
      Buffer.from('opencode:test-password').toString('base64')
    )
  })

  it('strips caller Bearer and injects Basic auth', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    await app.request('/api/opencode-proxy/doc', {
      headers: {
        Authorization: 'Bearer test-internal-token',
        'x-opencode-directory': '/some/dir',
      },
    })

    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchHeaders = fetchCall[1].headers as Record<string, string>

    expect(fetchHeaders['Authorization']).not.toContain('Bearer')
    expect(fetchHeaders['Authorization']).toMatch(/^Basic /)
    expect(fetchHeaders['x-opencode-directory']).toBe('/some/dir')
  })

  it('forwards x-opencode-directory header unchanged', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    await app.request('/api/opencode-proxy/doc', {
      headers: {
        Authorization: 'Bearer test-internal-token',
        'x-opencode-directory': '/home/user/project',
        'x-opencode-workspace': 'my-workspace',
      },
    })

    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchHeaders = fetchCall[1].headers as Record<string, string>

    expect(fetchHeaders['x-opencode-directory']).toBe('/home/user/project')
    expect(fetchHeaders['x-opencode-workspace']).toBe('my-workspace')
  })

  it('returns 501 for WebSocket upgrade requests', async () => {
    const res = await app.request('/api/opencode-proxy/ws', {
      headers: {
        Authorization: 'Bearer test-internal-token',
        Connection: 'Upgrade',
        Upgrade: 'websocket',
      },
    })
    expect(res.status).toBe(501)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('WebSocket')
  })

  it('preserves SSE content-type header from upstream', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('event: message\ndata: hello\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/events', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
  })

  it('does not buffer SSE response body', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('data: chunk1\n\ndata: chunk2\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/events', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(res.body).toBeDefined()
  })

  it('returns 502 when upstream fetch fails', async () => {
    const upstreamFetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Proxy request failed')
  })

  it('preserves query string in upstream URL', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    await app.request('/api/opencode-proxy/doc?foo=bar&baz=qux', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchUrl = fetchCall[0]
    expect(fetchUrl).toContain('?foo=bar&baz=qux')
  })

  it('strips hop-by-hop headers from request', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    await app.request('/api/opencode-proxy/doc', {
      headers: {
        Authorization: 'Bearer test-internal-token',
        Host: 'localhost:5003',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    })

    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchHeaders = fetchCall[1].headers as Record<string, string>

    expect(fetchHeaders['Host']).toBeUndefined()
    expect(fetchHeaders['host']).toBeUndefined()
    expect(fetchHeaders['Connection']).toBeUndefined()
    expect(fetchHeaders['connection']).toBeUndefined()
    expect(fetchHeaders['Transfer-Encoding']).toBeUndefined()
    expect(fetchHeaders['transfer-encoding']).toBeUndefined()
  })

  it('strips hop-by-hop headers from response', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          connection: 'keep-alive',
          'transfer-encoding': 'chunked',
        },
      })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.headers.get('connection')).toBeNull()
    expect(res.headers.get('transfer-encoding')).toBeNull()
    expect(res.headers.get('content-type')).toBe('text/plain')
  })
})
