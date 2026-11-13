import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { parseJsonText } from '@opencode-manager/shared/utils'
import {
  createAuthenticatedOpenCodeProxyRoutes,
  type OpenCodeLifecycleGate,
  type OpenCodeProxyClient,
} from '../../src/routes/opencode-auth-proxy'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { OpenCodeSupervisor, type OpenCodeSupervisorManager } from '../../src/services/opencode-supervisor'
import { createFetchStub } from '../helpers/fetch-stub'

const passThroughAuth: MiddlewareHandler = async (c, next) => {
  await next()
}

const okResponse = () => new Response('ok', { status: 200 })

function createLifecycleGate(initialized: boolean): OpenCodeLifecycleGate & { initialized: boolean } {
  return {
    initialized,
    isLifecycleInitialized() {
      return this.initialized
    },
  }
}

function createProxyClient(forwardRaw: Mock<OpenCodeProxyClient['forwardRaw']>): OpenCodeProxyClient {
  return { forwardRaw }
}

function buildApp(
  forwardRaw: Mock<OpenCodeProxyClient['forwardRaw']>,
  lifecycleGate: OpenCodeLifecycleGate = createLifecycleGate(true),
) {
  const app = new Hono()
  app.route('/api/opencode', createAuthenticatedOpenCodeProxyRoutes(createProxyClient(forwardRaw), passThroughAuth, lifecycleGate))
  return app
}

function forwardedRequest(forwardRaw: Mock<OpenCodeProxyClient['forwardRaw']>): Request {
  const request = forwardRaw.mock.calls[0]?.[0]
  if (!request) throw new Error('the proxy did not forward a request')
  return request
}

async function forwardedJson(forwardRaw: Mock<OpenCodeProxyClient['forwardRaw']>): Promise<JsonValue> {
  return parseJsonText(await forwardedRequest(forwardRaw).text())
}

function createSupervisorManager(
  lifecycle: { initialized: boolean },
  overrides: Partial<OpenCodeSupervisorManager> = {},
): OpenCodeSupervisorManager {
  return {
    start: vi.fn<OpenCodeSupervisorManager['start']>(async () => undefined),
    stop: vi.fn<OpenCodeSupervisorManager['stop']>(async () => undefined),
    restart: vi.fn<OpenCodeSupervisorManager['restart']>(async () => undefined),
    checkHealth: vi.fn<OpenCodeSupervisorManager['checkHealth']>(async () => true),
    isOperationInProgress: vi.fn<OpenCodeSupervisorManager['isOperationInProgress']>(() => false),
    clearStartupError: vi.fn<OpenCodeSupervisorManager['clearStartupError']>(),
    getLastStartupError: vi.fn<OpenCodeSupervisorManager['getLastStartupError']>(() => null),
    isLastStartupErrorNonRecoverable: vi.fn<OpenCodeSupervisorManager['isLastStartupErrorNonRecoverable']>(() => false),
    setLifecycleInitialized: vi.fn<OpenCodeSupervisorManager['setLifecycleInitialized']>((value: boolean) => {
      lifecycle.initialized = value
    }),
    getPort: vi.fn<OpenCodeSupervisorManager['getPort']>(() => 5551),
    getVersion: vi.fn<OpenCodeSupervisorManager['getVersion']>(() => '2.0.15'),
    getMinVersion: vi.fn<OpenCodeSupervisorManager['getMinVersion']>(() => '2.0.15'),
    isVersionSupported: vi.fn<OpenCodeSupervisorManager['isVersionSupported']>(() => true),
    ...overrides,
  }
}

describe('authenticated opencode proxy routes', () => {
  let forwardRaw: Mock<OpenCodeProxyClient['forwardRaw']>

  beforeEach(() => {
    forwardRaw = vi.fn<OpenCodeProxyClient['forwardRaw']>(async () => okResponse())
  })

  it.each([
    ['an ordinary endpoint', '/api/opencode/session/ses_1/message', { method: 'GET' }],
    ['an MCP auth endpoint', '/api/opencode/mcp/evil-server/auth', { method: 'POST' }],
    ['an MCP authenticate endpoint', '/api/opencode/mcp/evil-server/auth/authenticate', { method: 'POST' }],
    ['the session shell endpoint', '/api/opencode/session/ses_1/shell', { method: 'POST' }],
  ])('returns 503 and never forwards %s when the OpenCode lifecycle is not initialized', async (_label, path, init) => {
    const res = await buildApp(forwardRaw, createLifecycleGate(false)).request(path, init)

    expect(res.status).toBe(503)
    expect(forwardRaw).not.toHaveBeenCalled()
  })

  it.each([
    ['an ordinary endpoint', '/api/opencode/session/ses_1/message', { method: 'GET' }],
    ['an MCP auth endpoint', '/api/opencode/mcp/evil-server/auth', { method: 'POST' }],
    ['an MCP authenticate endpoint', '/api/opencode/mcp/evil-server/auth/authenticate', { method: 'POST' }],
    ['the session shell endpoint', '/api/opencode/session/ses_1/shell', { method: 'POST' }],
    ['a percent-encoded PTY path', '/api/opencode/%70ty', { method: 'POST' }],
  ])('forwards %s when the lifecycle is initialized', async (_label, path, init) => {
    const res = await buildApp(forwardRaw).request(path, init)

    expect(res.status).toBe(200)
    expect(forwardRaw).toHaveBeenCalledTimes(1)
    expect(forwardedRequest(forwardRaw).url).toContain(path)
  })

  it('returns 503 through the proxy gate on a below-threshold health failure and reopens once the supervisor recovers', async () => {
    const lifecycle = { initialized: true }
    const checkHealth = vi.fn<OpenCodeSupervisorManager['checkHealth']>(async () => true)
    const manager = createSupervisorManager(lifecycle, { checkHealth })
    const supervisor = new OpenCodeSupervisor(
      manager,
      { getLastKnownGoodConfig: () => null },
      { failureThreshold: 2, watchEnabled: false },
    )
    await supervisor.start()
    const gate: OpenCodeLifecycleGate = { isLifecycleInitialized: () => lifecycle.initialized }

    const healthyRes = await buildApp(forwardRaw, gate).request('/api/opencode/session/ses_1/message')
    expect(healthyRes.status).toBe(200)
    expect(forwardRaw).toHaveBeenCalledTimes(1)

    checkHealth.mockResolvedValueOnce(false)
    const status = await supervisor.checkNow('manual')
    expect(status.state).toBe('unhealthy')
    expect(lifecycle.initialized).toBe(false)

    const blockedRes = await buildApp(forwardRaw, gate).request('/api/opencode/session/ses_1/message')
    expect(blockedRes.status).toBe(503)
    expect(forwardRaw).toHaveBeenCalledTimes(1)

    checkHealth.mockResolvedValueOnce(true)
    const recovered = await supervisor.checkNow('manual')
    expect(recovered.healthy).toBe(true)
    expect(lifecycle.initialized).toBe(true)

    const reopenedRes = await buildApp(forwardRaw, gate).request('/api/opencode/session/ses_1/message')
    expect(reopenedRes.status).toBe(200)
    expect(forwardRaw).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['plugins', { theme: 'dark', plugin: ['opencode-plugin-npm'] }],
    [
      'local MCP servers and formatter config',
      { formatter: { command: 'prettier' }, mcp: { local: { type: 'local', command: ['node', 'server.js'] } } },
    ],
    [
      'LSP servers and experimental hooks',
      {
        lsp: { typescript: { command: ['typescript-language-server'] } },
        experimental: { hook: { file_edited: [{ command: ['chmod', '+x', 'x'] }] }, chatMaxRetries: 4 },
      },
    ],
    ['custom provider npm selectors', { model: 'x', provider: { evil: { npm: 'file:///repo/evil-provider.js' } } }],
    ['a body without host-execution sections', { theme: 'dark' }],
  ])('forwards a PATCH /config mutation with %s unchanged', async (_label, body) => {
    const res = await buildApp(forwardRaw).request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(200)
    expect(forwardRaw).toHaveBeenCalledTimes(1)
    expect(await forwardedJson(forwardRaw)).toEqual(body)
  })

  it('forwards a malformed PATCH /config body unchanged', async () => {
    const res = await buildApp(forwardRaw).request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(200)
    expect(await forwardedRequest(forwardRaw).text()).toBe('{not json')
  })

  it.each([
    ['a local MCP server', { name: 'evil', config: { type: 'local', command: ['node', 'server.js'] } }],
    ['a remote MCP server', { name: 'remote-server', config: { type: 'remote', url: 'https://example.com/mcp' } }],
  ])('forwards an add of %s', async (_label, body) => {
    const res = await buildApp(forwardRaw).request('/api/opencode/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(200)
    expect(forwardRaw).toHaveBeenCalledTimes(1)
    expect(await forwardedJson(forwardRaw)).toEqual(body)
  })

  it.each([
    ['a well-known write', { type: 'wellknown', key: 'SSO_TOKEN', token: 't' }],
    ['an api key write', { type: 'api', key: 'sk-test' }],
    ['an oauth write', { type: 'oauth', access: 'access-token' }],
  ])('forwards %s', async (_label, body) => {
    const res = await buildApp(forwardRaw).request('/api/opencode/auth/sso.example.com', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(200)
    expect(forwardRaw).toHaveBeenCalledTimes(1)
    expect(await forwardedJson(forwardRaw)).toEqual(body)
  })
})

describe('authenticated opencode proxy streaming', () => {
  it('streams the upstream body chunk by chunk while forwarding the request body as a stream', async () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller
      },
    })

    const fetchFn = createFetchStub(async () => (
      new Response(upstreamBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    ))
    const client = new FetchOpenCodeClient({
      baseUrl: 'http://127.0.0.1:5551',
      basicAuth: '',
      fetchFn,
    })

    const app = new Hono()
    app.route('/api/opencode', createAuthenticatedOpenCodeProxyRoutes(client, passThroughAuth, createLifecycleGate(true)))

    const responsePromise = app.request('/api/opencode/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    })

    upstreamController.enqueue(encoder.encode('first-chunk'))
    const response = await responsePromise
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const body = response.body
    if (!body) throw new Error('the proxied response has no body')
    const reader = body.getReader()
    const first = await reader.read()
    expect(decoder.decode(first.value)).toBe('first-chunk')

    upstreamController.enqueue(encoder.encode('second-chunk'))
    const second = await reader.read()
    expect(decoder.decode(second.value)).toBe('second-chunk')
    upstreamController.close()
    await reader.cancel()

    const capturedInit = fetchFn.mock.calls[0]?.[1]
    expect(capturedInit?.body).toBeInstanceOf(ReadableStream)
    expect(capturedInit?.duplex).toBe('half')
  })
})
