import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { createAuthenticatedOpenCodeProxyRoutes } from '../../src/routes/opencode-auth-proxy'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import type { SettingsService } from '../../src/services/settings'

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

const forwardRawMock = vi.hoisted(() => vi.fn<OpenCodeClient['forwardRaw']>(async () => new Response('ok', { status: 200 })))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

const passThroughAuth: MiddlewareHandler = async (c, next) => {
  await next()
}

function buildApp() {
  const app = new Hono()
  app.route(
    '/api/opencode',
    createAuthenticatedOpenCodeProxyRoutes({ forwardRaw: forwardRawMock } as unknown as OpenCodeClient, passThroughAuth),
  )
  return app
}

describe('authenticated opencode proxy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSandboxEnforcedMock.mockReturnValue(false)
    isLifecycleInitializedMock.mockReturnValue(true)
    forwardRawMock.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  it('returns 503 and never forwards when the OpenCode lifecycle is not initialized', async () => {
    isLifecycleInitializedMock.mockReturnValue(false)
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/message')
    expect(res.status).toBe(503)
    expect(forwardRawMock).not.toHaveBeenCalled()
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

    const healthyRes = await buildApp().request('/api/opencode/session/ses_1/message')
    expect(healthyRes.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)

    manager.checkHealth.mockResolvedValueOnce(false)
    const status = await supervisor.checkNow('manual')
    expect(status.state).toBe('unhealthy')
    expect(lifecycle.initialized).toBe(false)

    const blockedRes = await buildApp().request('/api/opencode/session/ses_1/message')
    expect(blockedRes.status).toBe(503)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)

    manager.checkHealth.mockResolvedValueOnce(true)
    const recovered = await supervisor.checkNow('manual')
    expect(recovered.healthy).toBe(true)
    expect(lifecycle.initialized).toBe(true)

    const reopenedRes = await buildApp().request('/api/opencode/session/ses_1/message')
    expect(reopenedRes.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(2)
  })

  it('forwards ordinary endpoints when enforcement is off', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/message')
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })

  it('returns 503 for MCP auth endpoints when the OpenCode lifecycle is not initialized', async () => {
    isLifecycleInitializedMock.mockReturnValue(false)
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp/evil-server/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(503)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('forwards MCP auth endpoints through the lifecycle-gated proxy when initialized', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp/evil-server/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = forwardRawMock.mock.calls[0]![0] as Request
    expect(forwarded.url).toContain('/api/opencode/mcp/evil-server/auth')
  })

  it('forwards MCP auth authenticate endpoints through the lifecycle-gated proxy when initialized', async () => {
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp/evil-server/auth/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = forwardRawMock.mock.calls[0]![0] as Request
    expect(forwarded.url).toContain('/api/opencode/mcp/evil-server/auth/authenticate')
  })

  it('blocks the session shell endpoint with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/shell', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('keeps host-process shell endpoints blocked when enforcement resolution failed (fail-closed manager state)', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/shell', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('blocks /api-prefixed PTY creation with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/api/pty', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('blocks percent-encoded shell spellings with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/%73hell', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
  })

  it('fails closed on encoded separators in proxied paths when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1%2Fshell', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
  })

  it('forwards safely encoded non-execution paths when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/session/ses_1/%6dessage')
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalled()
  })

  it('sanitizes plugins from a PATCH /config mutation when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.theme).toBe('dark')
    expect(forwarded.plugin).toBeUndefined()
  })

  it('sanitizes local MCP servers and formatter config from a PATCH /config mutation when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formatter: { command: 'prettier' },
        mcp: { local: { type: 'local', command: ['node', 'server.js'] } },
      }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.formatter).toBeUndefined()
    expect(forwarded.mcp).toBeUndefined()
  })

  it('rejects a malformed PATCH /config body with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
  })

  it('forwards PATCH /config mutations raw when enforcement is off', async () => {
    isSandboxEnforcedMock.mockReturnValue(false)
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark', plugin: ['opencode-plugin-npm'] }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.plugin).toEqual(['opencode-plugin-npm'])
  })

  it('rejects a local MCP server add with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'evil',
        config: { type: 'local', command: ['node', 'server.js'] },
      }),
    })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
    expect(body.error).toContain('only remote MCP servers')
  })

  it('forwards a remote MCP server add when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'remote-server',
        config: { type: 'remote', url: 'https://example.com/mcp' },
      }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({
      name: 'remote-server',
      config: { type: 'remote', url: 'https://example.com/mcp' },
    })
  })

  it('forwards MCP server adds raw when enforcement is off', async () => {
    isSandboxEnforcedMock.mockReturnValue(false)
    const app = buildApp()
    const res = await app.request('/api/opencode/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'local-server',
        config: { type: 'local', command: ['node', 'server.js'] },
      }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as { config: { type: string } }
    expect(forwarded.config.type).toBe('local')
  })

  it('sanitizes LSP servers and experimental hooks from a PATCH /config mutation when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lsp: { typescript: { command: ['typescript-language-server'] } },
        experimental: {
          hook: { file_edited: [{ command: ['chmod', '+x', 'x'] }] },
          chatMaxRetries: 4,
        },
      }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.lsp).toBeUndefined()
    expect(forwarded.experimental).toEqual({ chatMaxRetries: 4 })
  })

  it('forwards a PATCH /config mutation without host-execution sections unchanged when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({ theme: 'dark' })
  })

  it('rejects a well-known auth write with 403 when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/auth/sso.example.com', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' }),
    })
    expect(res.status).toBe(403)
    expect(forwardRawMock).not.toHaveBeenCalled()
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Sandbox enforcement is on')
    expect(body.error).toContain('well-known')
  })

  it('forwards api and oauth auth writes when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/auth/anthropic', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'api', key: 'sk-test' }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded).toEqual({ type: 'api', key: 'sk-test' })
  })

  it('forwards auth writes raw when enforcement is off', async () => {
    isSandboxEnforcedMock.mockReturnValue(false)
    const app = buildApp()
    const res = await app.request('/api/opencode/auth/sso.example.com', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'wellknown', key: 'SSO_TOKEN', token: 't' }),
    })
    expect(res.status).toBe(200)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.type).toBe('wellknown')
  })

  it('strips custom provider npm selectors from a PATCH /config mutation when enforced', async () => {
    isSandboxEnforcedMock.mockReturnValue(true)
    const app = buildApp()
    const res = await app.request('/api/opencode/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'x',
        provider: {
          evil: { npm: 'file:///repo/evil-provider.js' },
          builtin: { options: { apiKey: 'k' } },
        },
      }),
    })
    expect(res.status).toBe(200)
    expect(forwardRawMock).toHaveBeenCalledTimes(1)
    const forwarded = JSON.parse(await (forwardRawMock.mock.calls[0]![0] as Request).text()) as Record<string, unknown>
    expect(forwarded.model).toBe('x')
    expect(forwarded.provider).toEqual({ builtin: { options: { apiKey: 'k' } } })
  })
})
