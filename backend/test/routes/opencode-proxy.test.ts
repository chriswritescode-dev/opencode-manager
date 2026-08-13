import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createOpenCodeProxyRoutes } from '../../src/routes/opencode-proxy'
import type { SettingsService } from '../../src/services/settings'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('../../src/services/internal-token', () => ({
  getOrCreateInternalToken: vi.fn().mockReturnValue('test-internal-token'),
}))

const isSandboxEnforcedMock = vi.hoisted(() => vi.fn().mockReturnValue(false))
const isLifecycleInitializedMock = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: { isSandboxEnforced: isSandboxEnforcedMock, isLifecycleInitialized: isLifecycleInitializedMock },
  OpenCodeServerManager: class {},
  getSandboxVerifiedOpenCodeVersions: () => [],
  isSandboxVerifiedOpenCodeVersion: () => false,
  sanitizeConfigForEnforcement: (config: Record<string, unknown>) => config,
  ConfigReloadError: class extends Error {},
  NonRecoverableStartupError: class extends Error {},
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
    isSandboxEnforcedMock.mockReturnValue(false)
    isLifecycleInitializedMock.mockReturnValue(true)
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

  it('returns 503 and never forwards when the OpenCode lifecycle is not initialized', async () => {
    isLifecycleInitializedMock.mockReturnValue(false)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/message', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(503)
    expect(upstreamFetch).not.toHaveBeenCalled()
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

  it('blocks the session shell endpoint with 403 when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/shell', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
    expect(body.error).toContain('host process')
  })

  it('keeps host-process shell endpoints blocked when enforcement resolution failed (fail-closed manager state)', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/shell', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
  })

  it('blocks percent-encoded shell spellings with 403 when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/%73hell', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
    expect(body.error).toContain('host process')
  })

  it('fails closed on encoded separators in proxied paths when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1%2Fshell', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('forwards safely encoded non-execution paths when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/%6dessage', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()
  })

  it('blocks PTY creation with 403 when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/pty', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('blocks /api-prefixed PTY creation with 403 when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/api/pty', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('blocks custom slash command execution with 403 when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/command', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('rejects a local MCP server add with 403 when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'evil',
        config: { type: 'local', command: ['node', 'server.js'] },
      }),
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
    expect(body.error).toContain('only remote MCP servers')
  })

  it('rejects a command-bearing MCP add without an explicit local type with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'evil',
        config: { command: ['npx', 'evil-server'] },
      }),
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('forwards a remote MCP server add when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'remote-server',
        config: { type: 'remote', url: 'https://example.com/mcp' },
      }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>
    expect(forwarded).toEqual({
      name: 'remote-server',
      config: { type: 'remote', url: 'https://example.com/mcp' },
    })
  })

  it('forwards MCP server adds raw when enforcement is off', async () => {
    isSandboxEnforcedMock.mockReturnValue(false)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'local-server',
        config: { type: 'local', command: ['node', 'server.js'] },
      }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as { config: { type: string } }
    expect(forwarded.config.type).toBe('local')
  })

  it('sanitizes LSP servers and experimental hooks from a PATCH /config mutation when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lsp: { typescript: { command: ['typescript-language-server'] } },
        experimental: {
          hook: { file_edited: [{ command: ['chmod', '+x', 'x'] }] },
          chatMaxRetries: 4,
        },
      }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>
    expect(forwarded.lsp).toBeUndefined()
    expect(forwarded.experimental).toEqual({ chatMaxRetries: 4 })
  })

  it('forwards ordinary agent endpoints when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/prompt_async', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()
  })

  it('sanitizes plugins from a PATCH /config mutation when the OpenCode child is enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>
    expect(forwarded.theme).toBe('dark')
    expect(forwarded.plugin).toBeUndefined()
  })

  it('sanitizes local MCP servers and formatter config from a PATCH /config mutation when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        formatter: { command: 'prettier' },
        mcp: { local: { type: 'local', command: ['node', 'server.js'] } },
      }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>
    expect(forwarded.formatter).toBeUndefined()
    expect(forwarded.mcp).toBeUndefined()
  })

  it('rejects a malformed PATCH /config body with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: '{not json',
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
  })

  it('forwards PATCH /config mutations raw when enforcement is off', async () => {
    isSandboxEnforcedMock.mockReturnValue(false)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded.plugin).toEqual(['opencode-plugin-npm'])
  })

  it('forwards non-config mutations raw when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/message', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'hello' }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded.content).toBe('hello')
  })

  it('rejects a well-known auth write with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('should not be reached'))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/auth/sso.example.com', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' }),
    })

    expect(res.status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
    expect(body.error).toContain('well-known')
  })

  it('forwards api and oauth auth writes when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/auth/anthropic', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'api', key: 'sk-test' }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded).toEqual({ type: 'api', key: 'sk-test' })
  })

  it('forwards auth writes raw when enforcement is off', async () => {
    isSandboxEnforcedMock.mockReturnValue(false)
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/auth/sso.example.com', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded.type).toBe('wellknown')
  })

  it('returns 503 through the proxy gate on a below-threshold health failure and reopens once the supervisor recovers', async () => {
    const lifecycle = { initialized: true }
    isLifecycleInitializedMock.mockImplementation(() => lifecycle.initialized)
    const manager = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isOperationInProgress: vi.fn(() => false),
      checkHealth: vi.fn().mockResolvedValue(true),
      restart: vi.fn().mockResolvedValue(undefined),
      reloadConfig: vi.fn().mockResolvedValue(undefined),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(() => null),
      isLastStartupErrorNonRecoverable: vi.fn(() => false),
      setLifecycleInitialized: vi.fn((value: boolean) => { lifecycle.initialized = value }),
      getPort: vi.fn(() => 5551),
      getVersion: vi.fn(() => '1.0.137'),
      getMinVersion: vi.fn(() => '1.0.137'),
      isVersionSupported: vi.fn(() => true),
    }
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, {} as SettingsService, {
      failureThreshold: 2,
      watchEnabled: false,
    })
    await supervisor.start()

    const upstreamFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const healthyRes = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })
    expect(healthyRes.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalledTimes(1)

    manager.checkHealth.mockResolvedValueOnce(false)
    const status = await supervisor.checkNow('manual')
    expect(status.state).toBe('unhealthy')
    expect(lifecycle.initialized).toBe(false)

    const blockedRes = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })
    expect(blockedRes.status).toBe(503)
    expect(upstreamFetch).toHaveBeenCalledTimes(1)

    manager.checkHealth.mockResolvedValueOnce(true)
    const recovered = await supervisor.checkNow('manual')
    expect(recovered.healthy).toBe(true)
    expect(lifecycle.initialized).toBe(true)

    const reopenedRes = await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })
    expect(reopenedRes.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalledTimes(2)
  })
})
