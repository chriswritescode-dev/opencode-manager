import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn } from 'child_process'
import { createServer, request } from 'http'
import type { Server, ServerResponse } from 'http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Hono } from 'hono'
import { createNodeWebSocket } from '@hono/node-ws'
import type { Database } from 'bun:sqlite'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { z } from 'zod'
import { createOpenCodeProxyRoutes } from '../../src/routes/opencode-proxy'
import { SettingsService } from '../../src/services/settings'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { DEFAULT_SERVER_INFO } from '../helpers/opencode-server-harness'
import { startHttpUpstream, type HttpUpstream, type RecordedUpstreamRequest } from '../helpers/http-upstream'
import { readJson } from '../helpers/read-json'
import { resolveOpenCode2Binary, startOpenCodeServe, type OpenCodeServe } from '../helpers/opencode-binary'
import { startWebSocketServer } from '../helpers/websocket-server'

const REPO_PATH = '/srv/repos/my-repo'
const ErrorResponseSchema = z.object({ error: z.string() })
const JsonLocationBodySchema = z.object({
  title: z.string(),
  location: z.object({ directory: z.string() }),
})

let upstreamBaseUrl = 'http://127.0.0.1:5551'

function respondOk(_request: RecordedUpstreamRequest, response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('ok')
}

describe('opencode-proxy routes', () => {
  let db: Database
  let settingsService: SettingsService
  let upstream: HttpUpstream
  let token: string
  let app: Hono

  beforeAll(async () => {
    upstream = await startHttpUpstream()
  })

  afterAll(async () => {
    await upstream.close()
  })

  beforeEach(() => {
    db = createTestDatabase()
    settingsService = new SettingsService(db)
    token = getOrCreateInternalToken(db)
    upstreamBaseUrl = upstream.baseUrl
    upstream.requests.length = 0
    upstream.setResponder(respondOk)
    opencodeServerManager.setLifecycleInitialized(true)
    app = createProxyApp()
  })

  afterEach(() => {
    opencodeServerManager.setLifecycleInitialized(true)
    opencodeServerManager.setOpenCodeClient(null)
    db.close()
  })

  function createProxyApp(): Hono {
    const proxyApp = new Hono()
    proxyApp.route(
      '/api/opencode-proxy',
      createOpenCodeProxyRoutes(
        db,
        settingsService,
        createNodeWebSocket({ app: proxyApp }).upgradeWebSocket,
        () => upstreamBaseUrl,
      ),
    )
    return proxyApp
  }

  const authHeaders = () => ({ Authorization: `Bearer ${token}` })

  it('returns 401 without authorization header', async () => {
    const res = await app.request('/api/opencode-proxy/doc')

    expect(res.status).toBe(401)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 503 and never forwards when the OpenCode lifecycle is not initialized', async () => {
    opencodeServerManager.setLifecycleInitialized(false)

    const res = await app.request('/api/opencode-proxy/session/ses_1/message', {
      method: 'POST',
      headers: authHeaders(),
    })

    expect(res.status).toBe(503)
    expect(upstream.requests).toHaveLength(0)
  })

  it.each([
    ['an invalid bearer token', 'Bearer wrong-token'],
    ['an invalid basic auth password', `Basic ${Buffer.from('opencode:wrong-password').toString('base64')}`],
  ])('returns 401 with %s', async (_label, authorization) => {
    const res = await app.request('/api/opencode-proxy/doc', { headers: { Authorization: authorization } })

    expect(res.status).toBe(401)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Unauthorized' })
  })

  it.each([
    ['a bearer token', 'bearer'],
    ['basic auth', 'basic'],
  ])('injects the managed Basic auth for %s', async (_label, scheme) => {
    const authorization = scheme === 'bearer'
      ? `Bearer ${token}`
      : `Basic ${Buffer.from(`opencode:${token}`).toString('base64')}`

    const res = await app.request('/api/opencode-proxy/doc', { headers: { Authorization: authorization } })

    expect(res.status).toBe(200)
    const [recorded] = upstream.requests
    expect(recorded?.url).toBe('/doc')
    expect(recorded?.headers.authorization).toBe(buildOpenCodeBasicAuth(settingsService.getOpenCodeServerPassword()))
  })

  it('forwards the location headers unchanged', async () => {
    const res = await app.request('/api/opencode-proxy/doc', {
      headers: {
        ...authHeaders(),
        'x-opencode-directory': '/home/user/project',
        'x-opencode-workspace': 'my-workspace',
      },
    })

    expect(res.status).toBe(200)
    const [recorded] = upstream.requests
    expect(recorded?.headers['x-opencode-directory']).toBe('/home/user/project')
    expect(recorded?.headers['x-opencode-workspace']).toBe('my-workspace')
  })

  it('defaults x-opencode-directory to the workspace when the caller sends no location', async () => {
    await app.request('/api/opencode-proxy/doc', { headers: authHeaders() })

    expect(upstream.requests[0]?.headers['x-opencode-directory']).toBe(encodeURIComponent(getWorkspacePath()))
  })

  it('returns 501 for WebSocket upgrade requests', async () => {
    const res = await app.request('/api/opencode-proxy/ws', {
      headers: { ...authHeaders(), Connection: 'Upgrade', Upgrade: 'websocket' },
    })

    expect(res.status).toBe(501)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({
      error: 'WebSocket proxying is only supported for ticketed persistent PTY connects',
    })
    expect(upstream.requests).toHaveLength(0)
  })

  it.each([
    '/api/opencode-proxy/ws',
    '/api/opencode-proxy/api/experimental/persistent-pty/pty_1/connect',
    '/api/opencode-proxy/api/pty/pty_1/connect?ticket=abc',
  ])('still requires authorization for WebSocket upgrades at %s', async (path) => {
    const res = await app.request(path, { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } })

    expect(res.status).toBe(401)
  })

  it('returns 403 for a ticketed persistent PTY connect from an untrusted origin', async () => {
    const res = await app.request('/api/opencode-proxy/api/experimental/persistent-pty/pty_1/connect?ticket=abc', {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', Origin: 'http://evil.example' },
    })

    expect(res.status).toBe(403)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Origin not allowed' })
  })

  it('returns 503 for a ticketed persistent PTY connect before lifecycle initialization', async () => {
    opencodeServerManager.setLifecycleInitialized(false)

    const res = await app.request('/api/opencode-proxy/api/experimental/persistent-pty/pty_1/connect?ticket=abc', {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
    })

    expect(res.status).toBe(503)
  })

  it('does not resolve a repo for a ticketed persistent PTY connect through the repo mount', async () => {
    const res = await app.request(
      '/api/opencode-proxy/repos/999/api/experimental/persistent-pty/pty_1/connect?ticket=abc',
      { headers: { Connection: 'Upgrade', Upgrade: 'websocket', Origin: 'http://evil.example' } },
    )

    expect(res.status).toBe(403)
  })

  it('streams an SSE response through with its content type', async () => {
    upstream.setResponder((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('event: message\ndata: hello\n\n')
    })

    const res = await app.request('/api/opencode-proxy/events', { headers: authHeaders() })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(await res.text()).toBe('event: message\ndata: hello\n\n')
  })

  it('returns 502 when the upstream fetch fails', async () => {
    upstreamBaseUrl = 'http://127.0.0.1:1'

    const res = await app.request('/api/opencode-proxy/doc', { headers: authHeaders() })

    expect(res.status).toBe(502)
    await expect(readJson(res, ErrorResponseSchema)).resolves.toEqual({ error: 'Proxy request failed' })
  })

  it('returns a null body for bodyless upstream statuses', async () => {
    upstream.setResponder((_request, response) => {
      response.writeHead(204)
      response.end()
    })

    const res = await app.request('/api/opencode-proxy/doc', { headers: authHeaders() })

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it.each([
    ['/session/ses_1/shell', 'POST', '/session/ses_1/shell'],
    ['/%70ty', 'POST', '/%70ty'],
    ['/session/ses_1/command', 'POST', '/session/ses_1/command'],
    ['/session/ses_1/prompt_async', 'POST', '/session/ses_1/prompt_async'],
    ['/doc?foo=bar&baz=qux', 'GET', '/doc?foo=bar&baz=qux'],
  ])('forwards %s to the upstream', async (path, method, expectedUrl) => {
    const res = await app.request(`/api/opencode-proxy${path}`, { method, headers: authHeaders() })

    expect(res.status).toBe(200)
    expect(upstream.requests[0]?.url).toBe(expectedUrl)
  })

  it('strips hop-by-hop headers from the request', async () => {
    await app.request('/api/opencode-proxy/doc', {
      headers: {
        ...authHeaders(),
        Host: 'localhost:5003',
        Connection: 'close',
        'Transfer-Encoding': 'chunked',
      },
    })

    const [recorded] = upstream.requests
    expect(recorded?.headers.host).toBe(`127.0.0.1:${upstream.port}`)
    expect(recorded?.headers.connection).not.toBe('close')
  })

  it('strips hop-by-hop headers from the response', async () => {
    upstream.setResponder((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/plain',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
      })
      response.end('ok')
    })

    const res = await app.request('/api/opencode-proxy/doc', { headers: authHeaders() })

    expect(res.headers.get('connection')).toBeNull()
    expect(res.headers.get('transfer-encoding')).toBeNull()
    expect(res.headers.get('content-type')).toBe('text/plain')
  })

  it.each([
    [
      'a local MCP server add',
      'POST',
      '/mcp',
      JSON.stringify({ name: 'evil', config: { type: 'local', command: ['node', 'server.js'] } }),
    ],
    [
      'a command-bearing MCP server add',
      'POST',
      '/mcp',
      JSON.stringify({ name: 'evil', config: { command: ['npx', 'evil-server'] } }),
    ],
    [
      'a remote MCP server add',
      'POST',
      '/mcp',
      JSON.stringify({ name: 'remote-server', config: { type: 'remote', url: 'https://example.com/mcp' } }),
    ],
    [
      'a config mutation with LSP servers and experimental hooks',
      'PATCH',
      '/config',
      JSON.stringify({
        lsp: { typescript: { command: ['typescript-language-server'] } },
        experimental: { hook: { file_edited: [{ command: ['chmod', '+x', 'x'] }] }, chatMaxRetries: 4 },
      }),
    ],
    [
      'a config mutation with plugins',
      'PATCH',
      '/config',
      JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] }),
    ],
    [
      'a config mutation with local MCP servers and formatter config',
      'PATCH',
      '/config',
      JSON.stringify({ formatter: { command: 'prettier' }, mcp: { local: { type: 'local', command: ['node', 'server.js'] } } }),
    ],
    ['a session mutation', 'PATCH', '/session/ses_1/message', JSON.stringify({ content: 'hello' })],
    [
      'a well-known auth write',
      'PUT',
      '/auth/sso.example.com',
      JSON.stringify({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' }),
    ],
    ['an api auth write', 'PUT', '/auth/anthropic', JSON.stringify({ type: 'api', key: 'sk-test' })],
  ])('forwards %s body unchanged', async (_label, method, path, body) => {
    const res = await app.request(`/api/opencode-proxy${path}`, {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body,
    })

    expect(res.status).toBe(200)
    expect(upstream.requests[0]?.body).toBe(body)
    expect(upstream.requests[0]?.headers['content-type']).toBe('application/json')
  })

  it('forwards a malformed config body unchanged', async () => {
    const res = await app.request('/api/opencode-proxy/config', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(200)
    expect(upstream.requests[0]?.body).toBe('{not json')
  })

  it('returns 503 through the proxy gate on a below-threshold health failure and reopens once the supervisor recovers', async () => {
    const health = vi.fn<OpenCodeApi['server']['info']>(async () => DEFAULT_SERVER_INFO)
    opencodeServerManager.setOpenCodeClient(createStubOpenCodeClient({ api: { server: { info: health } } }))
    const supervisor = new OpenCodeSupervisor(opencodeServerManager, settingsService, {
      failureThreshold: 2,
      watchEnabled: false,
    })

    const healthyRes = await app.request('/api/opencode-proxy/doc', { headers: authHeaders() })
    expect(healthyRes.status).toBe(200)
    expect(upstream.requests).toHaveLength(1)

    health.mockRejectedValueOnce(new Error('OpenCode health check failed'))
    const status = await supervisor.checkNow('manual')
    expect(status.state).toBe('unhealthy')
    expect(opencodeServerManager.isLifecycleInitialized()).toBe(false)

    const blockedRes = await app.request('/api/opencode-proxy/doc', { headers: authHeaders() })
    expect(blockedRes.status).toBe(503)
    expect(upstream.requests).toHaveLength(1)

    const recovered = await supervisor.checkNow('manual')
    expect(recovered.healthy).toBe(true)
    expect(opencodeServerManager.isLifecycleInitialized()).toBe(true)

    const reopenedRes = await app.request('/api/opencode-proxy/doc', { headers: authHeaders() })
    expect(reopenedRes.status).toBe(200)
    expect(upstream.requests).toHaveLength(2)
  })
})

describe('opencode-proxy repo-scoped mount', () => {
  let db: Database
  let settingsService: SettingsService
  let upstream: HttpUpstream
  let token: string
  let repoId: number
  let app: Hono

  beforeAll(async () => {
    upstream = await startHttpUpstream()
  })

  afterAll(async () => {
    await upstream.close()
  })

  beforeEach(() => {
    db = createTestDatabase()
    settingsService = new SettingsService(db)
    token = getOrCreateInternalToken(db)
    repoId = seedRepo(db, { localPath: 'my-repo', sourcePath: REPO_PATH }).id
    upstreamBaseUrl = upstream.baseUrl
    upstream.requests.length = 0
    upstream.setResponder(respondOk)
    opencodeServerManager.setLifecycleInitialized(true)
    app = createProxyApp()
  })

  afterEach(() => {
    db.close()
  })

  function createProxyApp(): Hono {
    const proxyApp = new Hono()
    proxyApp.route(
      '/api/opencode-proxy',
      createOpenCodeProxyRoutes(
        db,
        settingsService,
        createNodeWebSocket({ app: proxyApp }).upgradeWebSocket,
        () => upstreamBaseUrl,
      ),
    )
    return proxyApp
  }

  const authHeaders = () => ({ Authorization: `Bearer ${token}` })

  it('returns 404 for an unknown repo', async () => {
    const res = await app.request('/api/opencode-proxy/repos/999/api/session', { headers: authHeaders() })

    expect(res.status).toBe(404)
    expect(upstream.requests).toHaveLength(0)
  })

  it('returns 404 for a non-ready repo', async () => {
    const cloning = seedRepo(db, { localPath: 'cloning-repo', cloneStatus: 'cloning' })

    const res = await app.request(`/api/opencode-proxy/repos/${cloning.id}/api/session`, { headers: authHeaders() })

    expect(res.status).toBe(404)
    expect(upstream.requests).toHaveLength(0)
  })

  it('pins x-opencode-directory to the repo path', async () => {
    const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/session?limit=1`, {
      headers: {
        ...authHeaders(),
        'x-opencode-directory': encodeURIComponent('/some/other/dir'),
      },
    })

    expect(res.status).toBe(200)
    const [recorded] = upstream.requests
    expect(recorded?.headers['x-opencode-directory']).toBe(encodeURIComponent(REPO_PATH))
    expect(recorded?.url).toBe('/api/session?limit=1')
  })

  it('rewrites the location[directory] query value', async () => {
    const res = await app.request(
      `/api/opencode-proxy/repos/${repoId}/api/agent?location%5Bdirectory%5D=${encodeURIComponent('/local/dir')}`,
      { headers: authHeaders() },
    )

    expect(res.status).toBe(200)
    const recordedUrl = upstream.requests[0]?.url ?? ''
    expect(new URL(recordedUrl, 'http://upstream.example').searchParams.get('location[directory]')).toBe(REPO_PATH)
  })

  it('rewrites the directory query on GET /api/session', async () => {
    const res = await app.request(
      `/api/opencode-proxy/repos/${repoId}/api/session?directory=/local/dir&limit=5`,
      { headers: authHeaders() },
    )

    expect(res.status).toBe(200)
    const recordedUrl = new URL(upstream.requests[0]?.url ?? '', 'http://upstream.example')
    expect(recordedUrl.searchParams.get('directory')).toBe(REPO_PATH)
    expect(recordedUrl.searchParams.get('limit')).toBe('5')
  })

  it('rewrites a JSON body top-level location.directory', async () => {
    const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/session`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', location: { directory: '/local/dir' } }),
    })

    expect(res.status).toBe(200)
    const forwarded = JsonLocationBodySchema.parse(JSON.parse(upstream.requests[0]?.body ?? ''))
    expect(forwarded).toEqual({ title: 'x', location: { directory: REPO_PATH } })
  })

  it('streams a non-JSON body through untouched', async () => {
    const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/session`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
      body: 'location=/local/dir',
    })

    expect(res.status).toBe(200)
    expect(upstream.requests[0]?.body).toBe('location=/local/dir')
  })

  it('forwards a JSON body without a location unchanged', async () => {
    const body = JSON.stringify({ title: 'x' })

    const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/session`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body,
    })

    expect(res.status).toBe(200)
    expect(upstream.requests[0]?.body).toBe(body)
  })

  it('forwards a malformed JSON body unchanged', async () => {
    const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/session`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(200)
    expect(upstream.requests[0]?.body).toBe('{not json')
  })

  describe('workspace directories', () => {
    const worktreePath = join(getWorkspacePath(), '.opencode', 'state', 'opencode', 'worktree', 'abc123', 'feature')
    const otherRepoPath = join(getWorkspacePath(), 'repos', 'other-repo')

    it('keeps a workspace x-opencode-directory', async () => {
      const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/agent`, {
        headers: {
          ...authHeaders(),
          'x-opencode-directory': encodeURIComponent(worktreePath),
        },
      })

      expect(res.status).toBe(200)
      expect(upstream.requests[0]?.headers['x-opencode-directory']).toBe(encodeURIComponent(worktreePath))
    })

    it('keeps another project location[directory] from the workspace', async () => {
      const res = await app.request(
        `/api/opencode-proxy/repos/${repoId}/api/agent?location%5Bdirectory%5D=${encodeURIComponent(otherRepoPath)}`,
        { headers: authHeaders() },
      )

      expect(res.status).toBe(200)
      const [recorded] = upstream.requests
      const recordedUrl = new URL(recorded?.url ?? '', 'http://upstream.example')
      expect(recordedUrl.searchParams.get('location[directory]')).toBe(otherRepoPath)
      expect(recorded?.headers['x-opencode-directory']).toBe(encodeURIComponent(otherRepoPath))
    })

    it('keeps a workspace body location.directory', async () => {
      const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/session`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x', location: { directory: worktreePath } }),
      })

      expect(res.status).toBe(200)
      const forwarded = JsonLocationBodySchema.parse(JSON.parse(upstream.requests[0]?.body ?? ''))
      expect(forwarded).toEqual({ title: 'x', location: { directory: worktreePath } })
    })

    it('keeps a workspace directory filter on the session list', async () => {
      const res = await app.request(
        `/api/opencode-proxy/repos/${repoId}/api/session?directory=${encodeURIComponent(worktreePath)}`,
        { headers: authHeaders() },
      )

      expect(res.status).toBe(200)
      const recordedUrl = new URL(upstream.requests[0]?.url ?? '', 'http://upstream.example')
      expect(recordedUrl.searchParams.get('directory')).toBe(worktreePath)
    })

    it('does not add a directory filter to an unfiltered session list', async () => {
      const res = await app.request(`/api/opencode-proxy/repos/${repoId}/api/session?limit=50&parentID=null`, {
        headers: authHeaders(),
      })

      expect(res.status).toBe(200)
      const recordedUrl = new URL(upstream.requests[0]?.url ?? '', 'http://upstream.example')
      expect(recordedUrl.searchParams.has('directory')).toBe(false)
    })
  })
})

const SHIPPED_OPENCODE_BIN = resolveOpenCode2Binary()

const BoundPortSchema = z.object({ port: z.number() })

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
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: BoundPortSchema.parse(server.address()).port, close: () => server.close() })
    })
  })
}

function runOpenCodeAgainstProxy(
  serverUrl: string,
  cwd: string,
  internalToken: string,
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
        OPENCODE_PASSWORD: internalToken,
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
  let instanceRoot: string
  let configHome: string
  let homeDirectory: string
  let instance: OpenCodeServe
  let llm: { port: number; close: () => void }
  let db: Database
  let settingsService: SettingsService
  let token: string

  beforeAll(async () => {
    instanceRoot = mkdtempSync(join(tmpdir(), 'ocm-proxy-e2e-'))
    configHome = join(instanceRoot, 'config')
    homeDirectory = join(instanceRoot, 'home')
    for (const directory of [join(configHome, 'opencode'), homeDirectory, join(instanceRoot, 'data'), join(instanceRoot, 'state'), join(instanceRoot, 'cache')]) {
      mkdirSync(directory, { recursive: true })
    }

    llm = await startMockLlm()
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

    instance = await startOpenCodeServe({ env: { HOME: homeDirectory, XDG_CONFIG_HOME: configHome } })
  })

  beforeEach(() => {
    db = createTestDatabase()
    settingsService = new SettingsService(db)
    token = getOrCreateInternalToken(db)
  })

  afterEach(() => {
    db.close()
    upstreamBaseUrl = 'http://127.0.0.1:5551'
  })

  afterAll(async () => {
    await instance.stop()
    llm.close()
    rmSync(instanceRoot, { recursive: true, force: true })
  })

  function connectToInstance(): void {
    upstreamBaseUrl = instance.baseUrl
    settingsService.setOpenCodeServerPassword(instance.password)
    opencodeServerManager.setLifecycleInitialized(true)
  }

  function seedRepoAt(repoPath: string): number {
    return seedRepo(db, { localPath: 'repo', sourcePath: repoPath }).id
  }

  it('pins the repo directory for a client started from an unrelated cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocm-proxy-e2e-'))
    const clientCwd = join(root, 'client-cwd')
    const repoPath = join(root, 'repo')
    for (const directory of [clientCwd, repoPath]) {
      mkdirSync(directory, { recursive: true })
    }

    connectToInstance()
    const repoId = seedRepoAt(repoPath)

    const { proxyServer, proxyPort } = await startProxyServer()

    try {
      const result = await runOpenCodeAgainstProxy(
        `http://127.0.0.1:${proxyPort}/api/opencode-proxy/repos/${repoId}`,
        clientCwd,
        token,
        homeDirectory,
        configHome,
      )
      expect(result.status, result.stderr || result.stdout).toBe(0)

      const response = await fetch(`${instance.baseUrl}/api/session?directory=${encodeURIComponent(repoPath)}`, {
        headers: { Authorization: buildOpenCodeBasicAuth(instance.password) },
      })
      const body = z.object({ data: z.array(z.object({ location: z.object({ directory: z.string() }) })) }).parse(await response.json())
      expect(body.data.some((session) => session.location.directory === repoPath)).toBe(true)
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  }, 120000)

  it('bridges a ticketed persistent PTY WebSocket for a remote client without an Authorization header', async () => {
    const ptyDaemonsBefore = listPtyDaemonPids()
    const root = mkdtempSync(join(tmpdir(), 'ocm-proxy-pty-'))
    const repoPath = join(root, 'repo')
    mkdirSync(repoPath, { recursive: true })

    connectToInstance()
    const repoId = seedRepoAt(repoPath)

    const { proxyServer, proxyPort } = await startProxyServer()
    const repoProxy = `127.0.0.1:${proxyPort}/api/opencode-proxy/repos/${repoId}`
    const clientAuth = `Basic ${Buffer.from(`opencode:${token}`).toString('base64')}`
    let leakedPtyDaemons: number[] = []

    try {
      const created = await fetch(`http://${repoProxy}/api/session`, {
        method: 'POST',
        headers: { Authorization: clientAuth, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'pty-bridge' }),
      })
      expect(created.status, await created.clone().text()).toBe(200)
      const sessionID = z.object({ data: z.object({ id: z.string() }) }).parse(await created.json()).data.id

      const terminal = await fetch(`http://${repoProxy}/api/experimental/session/${sessionID}/terminal`, {
        method: 'POST',
        headers: { Authorization: clientAuth, 'content-type': 'application/json' },
        body: JSON.stringify({ command: '/bin/sh', args: [], title: 'pty-bridge', env: {}, cwd: repoPath }),
      })
      expect(terminal.status, await terminal.clone().text()).toBe(200)
      const ptyID = z.object({ data: z.object({ id: z.string() }) }).parse(await terminal.json()).data.id

      const tokenResponse = await fetch(`http://${repoProxy}/api/experimental/persistent-pty/${ptyID}/connect-token`, {
        method: 'POST',
        headers: { Authorization: clientAuth, 'x-opencode-ticket': '1' },
      })
      expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200)
      const ticket = z.object({ data: z.object({ ticket: z.string() }) }).parse(await tokenResponse.json()).data.ticket

      const socket = new WebSocket(`ws://${repoProxy}/api/experimental/persistent-pty/${ptyID}/connect?ticket=${encodeURIComponent(ticket)}`)
      socket.binaryType = 'arraybuffer'
      const output = await new Promise<string>((resolve, reject) => {
        let received = ''
        let sent = false
        const timer = setTimeout(() => reject(new Error(`timed out; received: ${received}`)), 20000)
        socket.addEventListener('message', (event) => {
          received += event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : String(event.data)
          if (!sent && received.includes('replay_complete')) {
            sent = true
            socket.send('echo proxied-$((40+2))\n')
          }
          if (received.includes('proxied-42')) {
            clearTimeout(timer)
            resolve(received)
          }
        })
        socket.addEventListener('close', (event) => {
          clearTimeout(timer)
          reject(new Error(`socket closed ${event.code}; received: ${received}`))
        })
      })
      socket.close()

      expect(output).toContain('proxied-42')
    } finally {
      await shutdownPersistentPty(repoProxy, clientAuth)
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()))
      leakedPtyDaemons = await waitForNoNewPtyDaemons(ptyDaemonsBefore)
      rmSync(root, { recursive: true, force: true })
    }

    expect(leakedPtyDaemons).toEqual([])
  }, 120000)

  it('rejects a persistent PTY connect with a bogus ticket as HTTP 403', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocm-proxy-pty-'))
    const repoPath = join(root, 'repo')
    mkdirSync(repoPath, { recursive: true })

    connectToInstance()
    const repoId = seedRepoAt(repoPath)

    const { proxyServer, proxyPort } = await startProxyServer()

    try {
      const status = await readUpgradeRejectionStatus(
        proxyPort,
        `/api/opencode-proxy/repos/${repoId}/api/experimental/persistent-pty/pty_bogus/connect?ticket=bogus`,
      )
      expect(status).toBe(403)
    } finally {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  }, 120000)

  async function startProxyServer(): Promise<{ proxyServer: Server; proxyPort: number }> {
    const { server, port } = await startWebSocketServer({
      app: new Hono(),
      register: (proxyApp, upgradeWebSocket) => {
        proxyApp.route(
          '/api/opencode-proxy',
          createOpenCodeProxyRoutes(db, settingsService, upgradeWebSocket, () => upstreamBaseUrl),
        )
      },
    })
    return { proxyServer: server, proxyPort: port }
  }
})

function listPtyDaemonPids(): number[] {
  try {
    return execFileSync('pgrep', ['-f', 'opencode-pty'], { encoding: 'utf8' })
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

async function waitForNoNewPtyDaemons(baseline: number[]): Promise<number[]> {
  const deadline = Date.now() + 10000
  let leaked: number[] = []
  while (Date.now() < deadline) {
    leaked = listPtyDaemonPids().filter((pid) => !baseline.includes(pid))
    if (leaked.length === 0) return []
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return leaked
}

async function shutdownPersistentPty(repoProxy: string, clientAuth: string): Promise<void> {
  await fetch(`http://${repoProxy}/api/experimental/persistent-pty/shutdown`, {
    method: 'POST',
    headers: { Authorization: clientAuth },
  }).catch(() => undefined)
}

function readUpgradeRejectionStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('upgrade', (res) => {
      res.destroy()
      resolve(101)
    })
    req.on('error', reject)
    req.end()
  })
}
