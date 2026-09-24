import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { Database } from 'bun:sqlite'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { createOpenCodeProxyRoutes } from '../../src/routes/opencode-proxy'
import type { SettingsService } from '../../src/services/settings'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import { resolveOpenCode2Binary, startOpenCodeServe } from '../helpers/opencode-binary'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('../../src/services/internal-token', () => ({
  getOrCreateInternalToken: vi.fn().mockReturnValue('test-internal-token'),
}))

const isLifecycleInitializedMock = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: { isLifecycleInitialized: isLifecycleInitializedMock },
}))

const getRepoByIdMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/db/queries', () => ({
  getRepoById: getRepoByIdMock,
}))

const upstreamBaseUrl = vi.hoisted(() => ({ value: 'http://127.0.0.1:5551' }))

vi.mock('../../src/services/opencode/upstream', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/opencode/upstream')>(),
  getOpenCodeUpstreamBaseUrl: () => upstreamBaseUrl.value,
}))

const getOpenCodeServerPasswordMock = vi.hoisted(() => vi.fn().mockReturnValue('test-password'))

const readyRepo = { id: 7, fullPath: '/srv/repos/my-repo', cloneStatus: 'ready' }

const mockSettingsService = {
  getOpenCodeServerPassword: getOpenCodeServerPasswordMock,
} as unknown as SettingsService

const mockDb = {} as Database

function upstreamOk() {
  const upstreamFetch = vi.fn().mockResolvedValue(
    new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  )
  globalThis.fetch = upstreamFetch as unknown as typeof fetch
  return upstreamFetch
}

describe('opencode-proxy routes', () => {
  let app: Hono
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('defaults x-opencode-directory to the workspace when the caller sends no location', async () => {
    const upstreamFetch = upstreamOk()

    await app.request('/api/opencode-proxy/doc', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    const fetchHeaders = (upstreamFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
    expect(fetchHeaders['x-opencode-directory']).toBe(encodeURIComponent(getWorkspacePath()))
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

  it('forwards the session shell endpoint', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/shell', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()
  })

  it('forwards percent-encoded PTY paths when the OpenCode child is enforced', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/%70ty', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()
  })

  it('forwards custom slash command execution when the OpenCode child is enforced', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const res = await app.request('/api/opencode-proxy/session/ses_1/command', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()
  })

  it('forwards a local MCP server add when the OpenCode child is enforced', async () => {
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
        name: 'evil',
        config: { type: 'local', command: ['node', 'server.js'] },
      }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded).toEqual({
      name: 'evil',
      config: { type: 'local', command: ['node', 'server.js'] },
    })
  })

  it('forwards a command-bearing MCP add without an explicit local type when the OpenCode child is enforced', async () => {
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
        name: 'evil',
        config: { command: ['npx', 'evil-server'] },
      }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded).toEqual({
      name: 'evil',
      config: { command: ['npx', 'evil-server'] },
    })
  })

  it('forwards a remote MCP server add when the OpenCode child is enforced', async () => {
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
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded).toEqual({
      name: 'remote-server',
      config: { type: 'remote', url: 'https://example.com/mcp' },
    })
  })

  it('forwards MCP server adds raw when enforcement is off', async () => {
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

  it('forwards a PATCH /config mutation with LSP servers and experimental hooks exactly when enforced', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const body = JSON.stringify({
      lsp: { typescript: { command: ['typescript-language-server'] } },
      experimental: {
        hook: { file_edited: [{ command: ['chmod', '+x', 'x'] }] },
        chatMaxRetries: 4,
      },
    })
    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body,
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded).toEqual(JSON.parse(body))
  })

  it('forwards ordinary agent endpoints when the OpenCode child is enforced', async () => {
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

  it('forwards a PATCH /config mutation with plugins exactly when the OpenCode child is enforced', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const body = JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] })
    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body,
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded).toEqual(JSON.parse(body))
  })

  it('forwards a PATCH /config mutation with local MCP servers and formatter config exactly when enforced', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    globalThis.fetch = upstreamFetch as unknown as typeof fetch

    const body = JSON.stringify({
      formatter: { command: 'prettier' },
      mcp: { local: { type: 'local', command: ['node', 'server.js'] } },
    })
    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body,
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(await new Response(fetchCall[1].body as ReadableStream).text()) as Record<string, unknown>
    expect(forwarded).toEqual(JSON.parse(body))
  })

  it('forwards a malformed PATCH /config body exactly when enforced', async () => {
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
      body: '{not json',
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    expect(await new Response(fetchCall[1].body as ReadableStream).text()).toBe('{not json')
  })

  it('forwards PATCH /config mutations raw when enforcement is off', async () => {
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

  it('forwards a well-known auth write when enforced', async () => {
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
    expect(forwarded).toEqual({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' })
  })

  it('forwards api and oauth auth writes when enforced', async () => {
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
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(() => null),
      isLastStartupErrorNonRecoverable: vi.fn(() => false),
      setLifecycleInitialized: vi.fn((value: boolean) => { lifecycle.initialized = value }),
      getPort: vi.fn(() => 5551),
      getVersion: vi.fn(() => '2.0.15'),
      getMinVersion: vi.fn(() => '2.0.15'),
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

describe('opencode-proxy repo-scoped mount', () => {
  let app: Hono
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    isLifecycleInitializedMock.mockReturnValue(true)
    originalFetch = globalThis.fetch
    app = new Hono()
    app.route('/api/opencode-proxy', createOpenCodeProxyRoutes(mockDb, mockSettingsService))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns 404 for an unknown repo', async () => {
    getRepoByIdMock.mockReturnValue(null)
    const upstreamFetch = upstreamOk()

    const res = await app.request('/api/opencode-proxy/repos/999/api/session', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(404)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-ready repo', async () => {
    getRepoByIdMock.mockReturnValue({ ...readyRepo, cloneStatus: 'cloning' })
    const upstreamFetch = upstreamOk()

    const res = await app.request('/api/opencode-proxy/repos/7/api/session', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(404)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('pins x-opencode-directory to the repo path', async () => {
    getRepoByIdMock.mockReturnValue(readyRepo)
    const upstreamFetch = upstreamOk()

    const res = await app.request('/api/opencode-proxy/repos/7/api/session?limit=1', {
      headers: {
        Authorization: 'Bearer test-internal-token',
        'x-opencode-directory': encodeURIComponent('/some/other/dir'),
      },
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchHeaders = fetchCall[1].headers as Record<string, string>
    expect(fetchHeaders['x-opencode-directory']).toBe(encodeURIComponent('/srv/repos/my-repo'))
    expect(fetchCall[0]).toBe('http://127.0.0.1:5551/api/session?limit=1&directory=%2Fsrv%2Frepos%2Fmy-repo')
  })

  it('rewrites the location[directory] query value', async () => {
    getRepoByIdMock.mockReturnValue(readyRepo)
    const upstreamFetch = upstreamOk()

    const res = await app.request(
      `/api/opencode-proxy/repos/7/api/agent?location%5Bdirectory%5D=${encodeURIComponent('/local/dir')}`,
      { headers: { Authorization: 'Bearer test-internal-token' } }
    )

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchUrl = new URL(fetchCall[0])
    expect(fetchUrl.searchParams.get('location[directory]')).toBe('/srv/repos/my-repo')
  })

  it('rewrites the directory query on GET /api/session', async () => {
    getRepoByIdMock.mockReturnValue(readyRepo)
    const upstreamFetch = upstreamOk()

    const res = await app.request('/api/opencode-proxy/repos/7/api/session?directory=/local/dir&limit=5', {
      headers: { Authorization: 'Bearer test-internal-token' },
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const fetchUrl = new URL(fetchCall[0])
    expect(fetchUrl.searchParams.get('directory')).toBe('/srv/repos/my-repo')
    expect(fetchUrl.searchParams.get('limit')).toBe('5')
  })

  it('rewrites a JSON body top-level location.directory', async () => {
    getRepoByIdMock.mockReturnValue(readyRepo)
    const upstreamFetch = upstreamOk()

    const res = await app.request('/api/opencode-proxy/repos/7/api/session', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'x', location: { directory: '/local/dir' } }),
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>
    expect(forwarded).toEqual({ title: 'x', location: { directory: '/srv/repos/my-repo' } })
  })

  it('leaves a non-JSON body untouched', async () => {
    getRepoByIdMock.mockReturnValue(readyRepo)
    const upstreamFetch = upstreamOk()

    const res = await app.request('/api/opencode-proxy/repos/7/api/session', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-internal-token',
        'Content-Type': 'text/plain',
      },
      body: 'location=/local/dir',
    })

    expect(res.status).toBe(200)
    const fetchCall = upstreamFetch.mock.calls[0] as [string, RequestInit]
    const forwarded = new TextDecoder().decode(fetchCall[1].body as ArrayBuffer)
    expect(forwarded).toBe('location=/local/dir')
  })
})

const SHIPPED_OPENCODE_BIN = resolveOpenCode2Binary()

function startMockLlm(): Promise<{ port: number; close: () => void }> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
      return
    }
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    req.on('data', () => undefined)
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const base = { id: 'chatcmpl-e2e', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() }))
  })
}

function runOpenCodeAgainstProxy(
  serverUrl: string,
  cwd: string,
  homeDirectory: string,
  configHome: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const binary = resolveOpenCode2Binary()
  if (!binary) throw new Error('no OpenCode 2 binary is available for the binary-backed test')
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['run', '--server', serverUrl, '--format', 'json', 'hi'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: homeDirectory,
        XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: join(configHome, '..', 'data'),
        XDG_STATE_HOME: join(configHome, '..', 'state'),
        XDG_CACHE_HOME: join(configHome, '..', 'cache'),
        OPENCODE_DISABLE_MODELS_FETCH: '1',
        OPENCODE_PASSWORD: 'test-internal-token',
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ status: null, stdout, stderr })
    }, 90000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code, stdout, stderr })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

describe.skipIf(SHIPPED_OPENCODE_BIN === null)('opencode-proxy repo-scoped mount against the shipped OpenCode 2 binary', () => {
  it('pins the repo directory for a client started from an unrelated cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocm-proxy-e2e-'))
    const configHome = join(root, 'config')
    const homeDirectory = join(root, 'home')
    const clientCwd = join(root, 'client-cwd')
    const repoPath = join(root, 'repo')
    for (const directory of [join(configHome, 'opencode'), homeDirectory, clientCwd, repoPath, join(root, 'data'), join(root, 'state'), join(root, 'cache')]) {
      mkdirSync(directory, { recursive: true })
    }

    const llm = await startMockLlm()
    writeFileSync(
      join(configHome, 'opencode', 'opencode.json'),
      JSON.stringify({
        providers: {
          mock: {
            package: '@opencode/ai/providers/openai-compatible',
            name: 'Mock',
            settings: { baseURL: `http://127.0.0.1:${llm.port}/v1`, apiKey: 'mock-key' },
            models: { 'mock-model': { name: 'Mock Model' } },
          },
        },
        model: 'mock/mock-model',
        permissions: [{ action: '*', resource: '*', effect: 'allow' }],
      }),
    )

    const instance = await startOpenCodeServe({ env: { HOME: homeDirectory, XDG_CONFIG_HOME: configHome } })
    upstreamBaseUrl.value = instance.baseUrl
    getOpenCodeServerPasswordMock.mockReturnValue(instance.password)
    getRepoByIdMock.mockReturnValue({ id: 1, fullPath: repoPath, cloneStatus: 'ready' })

    const proxyApp = new Hono()
    proxyApp.route('/api/opencode-proxy', createOpenCodeProxyRoutes(mockDb, mockSettingsService))
    const proxyServer = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const server = serve({ fetch: proxyApp.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(server))
    })
    const proxyPort = (proxyServer.address() as AddressInfo).port

    try {
      const result = await runOpenCodeAgainstProxy(
        `http://127.0.0.1:${proxyPort}/api/opencode-proxy/repos/1`,
        clientCwd,
        homeDirectory,
        configHome,
      )
      expect(result.status, result.stderr || result.stdout).toBe(0)

      const response = await fetch(`${instance.baseUrl}/api/session?directory=${encodeURIComponent(repoPath)}`, {
        headers: { Authorization: buildOpenCodeBasicAuth(instance.password) },
      })
      const body = (await response.json()) as { data: { location: { directory: string } }[] }
      expect(body.data.some((session) => session.location.directory === repoPath)).toBe(true)
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()))
      await instance.stop()
      llm.close()
      getOpenCodeServerPasswordMock.mockReturnValue('test-password')
      upstreamBaseUrl.value = 'http://127.0.0.1:5551'
      rmSync(root, { recursive: true, force: true })
    }
  }, 120000)
})
