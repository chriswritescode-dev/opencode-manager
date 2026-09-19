import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { dirname } from 'path'
import type { MiddlewareHandler } from 'hono'
import { createMcpOauthProxyRoutes } from '../../src/routes/mcp-oauth-proxy'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import type { OpenCodeClient } from '../../src/services/opencode/client'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const WORKSPACE_PATH = '/tmp/test-workspace'
const MCP_AUTH_PATH = `${WORKSPACE_PATH}/.opencode/state/opencode/mcp-auth.json`
const SERVER_URL = 'https://mcp.example.com'
const AUTHORIZATION_ENDPOINT = `${SERVER_URL}/authorize`
const TOKEN_ENDPOINT = `${SERVER_URL}/token`
const REGISTRATION_ENDPOINT = `${SERVER_URL}/register`

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

function discoveryMetadata(overrides: Record<string, unknown> = {}) {
  return {
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    ...overrides,
  }
}

function createApp(
  client: OpenCodeClient = createStubOpenCodeClient(),
  requireAuth?: MiddlewareHandler,
) {
  return createMcpOauthProxyRoutes(client, requireAuth)
}

async function startFlow(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request('/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ serverName: 'my-server', serverUrl: SERVER_URL, ...body }),
  })
}

async function readAuthFile(): Promise<Record<string, {
  serverUrl: string
  tokens: Record<string, unknown>
  clientInfo: Record<string, unknown>
}>> {
  return JSON.parse(await readFile(MCP_AUTH_PATH, 'utf-8')) as Record<string, {
    serverUrl: string
    tokens: Record<string, unknown>
    clientInfo: Record<string, unknown>
  }>
}

describe('mcp oauth proxy routes', () => {
  beforeEach(async () => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    await rm(MCP_AUTH_PATH, { force: true })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(MCP_AUTH_PATH, { force: true })
  })

  describe('POST /start', () => {
    it('returns 400 when OAuth metadata discovery responds with an error', async () => {
      fetchMock.mockResolvedValueOnce(textResponse('not found', 404))

      const res = await startFlow(createApp())
      const json = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('OAuth metadata discovery failed for this MCP server')
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/.well-known/oauth-authorization-server`,
        expect.objectContaining({ headers: { 'MCP-Protocol-Version': '2025-03-26' } }),
      )
    })

    it('returns 400 when OAuth metadata discovery throws', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'))

      const res = await startFlow(createApp())
      const json = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('OAuth metadata discovery failed for this MCP server')
    })

    it('returns 400 when the server has no registration endpoint and no clientId is provided', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))

      const res = await startFlow(createApp())
      const json = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('Server does not support dynamic client registration and no clientId provided')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('builds the authorization URL with a provided clientId and forwarded proto', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))

      const res = await startFlow(
        createApp(),
        { clientId: 'client-123', scope: 'read write' },
        { 'x-forwarded-proto': 'https', host: 'manager.example.com' },
      )
      const json = await res.json() as { authorizationUrl: string; flowId: string }
      const authUrl = new URL(json.authorizationUrl)

      expect(res.status).toBe(200)
      expect(`${authUrl.origin}${authUrl.pathname}`).toBe(AUTHORIZATION_ENDPOINT)
      expect(authUrl.searchParams.get('response_type')).toBe('code')
      expect(authUrl.searchParams.get('client_id')).toBe('client-123')
      expect(authUrl.searchParams.get('redirect_uri')).toBe('https://manager.example.com/api/mcp-oauth-proxy/callback')
      expect(authUrl.searchParams.get('state')).toBe(json.flowId)
      expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
      expect(authUrl.searchParams.get('scope')).toBe('read write')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('uses the origin header for the callback URL when no forwarded proto is present', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))

      const res = await startFlow(
        createApp(),
        { clientId: 'client-123' },
        { origin: 'http://localhost:5173' },
      )
      const json = await res.json() as { authorizationUrl: string }
      const authUrl = new URL(json.authorizationUrl)

      expect(res.status).toBe(200)
      expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/mcp-oauth-proxy/callback')
    })

    it('falls back to the request host for the callback URL', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))

      const res = await startFlow(createApp(), { clientId: 'client-123' }, { host: 'manager.example.com' })
      const json = await res.json() as { authorizationUrl: string }
      const authUrl = new URL(json.authorizationUrl)

      expect(res.status).toBe(200)
      expect(authUrl.searchParams.get('redirect_uri')).toBe('http://manager.example.com/api/mcp-oauth-proxy/callback')
    })

    it('falls back to localhost:5003 for the callback URL when no host headers are present', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))

      const res = await startFlow(createApp(), { clientId: 'client-123' })
      const json = await res.json() as { authorizationUrl: string }
      const authUrl = new URL(json.authorizationUrl)

      expect(res.status).toBe(200)
      expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:5003/api/mcp-oauth-proxy/callback')
    })

    it('registers a client dynamically when no clientId is provided', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryMetadata({ registration_endpoint: REGISTRATION_ENDPOINT })))
        .mockResolvedValueOnce(jsonResponse({ client_id: 'dynamic-client' }))

      const res = await startFlow(createApp())
      const json = await res.json() as { authorizationUrl: string }
      const authUrl = new URL(json.authorizationUrl)
      const registrationCall = fetchMock.mock.calls[1]!
      const registrationInit = registrationCall[1] as RequestInit
      const registrationBody = JSON.parse(registrationInit.body as string) as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(authUrl.searchParams.get('client_id')).toBe('dynamic-client')
      expect(registrationCall[0]).toBe(REGISTRATION_ENDPOINT)
      expect(registrationInit.method).toBe('POST')
      expect(registrationBody.redirect_uris).toEqual(['http://localhost:5003/api/mcp-oauth-proxy/callback'])
      expect(registrationBody.client_name).toBe('OpenCode Manager')
      expect(registrationBody.token_endpoint_auth_method).toBe('none')
    })

    it('registers with client_secret_post when a clientSecret is provided', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryMetadata({ registration_endpoint: REGISTRATION_ENDPOINT })))
        .mockResolvedValueOnce(jsonResponse({ client_id: 'dynamic-client', client_secret: 'dynamic-secret' }))

      const res = await startFlow(createApp(), { clientSecret: 'seed-secret' })
      const registrationCall = fetchMock.mock.calls[1]!
      const registrationInit = registrationCall[1] as RequestInit
      const registrationBody = JSON.parse(registrationInit.body as string) as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(registrationBody.token_endpoint_auth_method).toBe('client_secret_post')
    })

    it('returns 500 when dynamic client registration responds with an error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryMetadata({ registration_endpoint: REGISTRATION_ENDPOINT })))
        .mockResolvedValueOnce(textResponse('bad request', 400))

      const res = await startFlow(createApp())
      const json = await res.json() as { error: string }

      expect(res.status).toBe(500)
      expect(json.error).toContain('Dynamic client registration failed')
    })

    it('returns 500 when the registration request throws', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryMetadata({ registration_endpoint: REGISTRATION_ENDPOINT })))
        .mockRejectedValueOnce(new Error('connection refused'))

      const res = await startFlow(createApp())
      const json = await res.json() as { error: string }

      expect(res.status).toBe(500)
      expect(json.error).toBe('connection refused')
    })

    it('returns 500 when the request body fails schema validation', async () => {
      const res = await createApp().request('/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName: 'my-server', serverUrl: 'not-a-url' }),
      })

      expect(res.status).toBe(500)
    })

    it('returns 500 when the request body is not valid JSON', async () => {
      const res = await createApp().request('/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })

      expect(res.status).toBe(500)
    })
  })

  describe('GET /status/:flowId', () => {
    it('returns unknown for an unknown flow', async () => {
      const res = await createApp().request('/status/does-not-exist')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'unknown' })
    })

    it('returns pending for a started flow', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const app = createApp()
      const started = await startFlow(app, { clientId: 'client-123' })
      const { flowId } = await started.json() as { flowId: string }

      const res = await app.request(`/status/${flowId}`)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'pending' })
    })
  })

  describe('GET /callback', () => {
    it('returns 400 when the state parameter is missing', async () => {
      const res = await createApp().request('/callback?code=abc')

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Missing State')
    })

    it('returns 400 and marks the flow failed when the provider reports an error', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const app = createApp()
      const started = await startFlow(app, { clientId: 'client-123' })
      const { flowId } = await started.json() as { flowId: string }

      const res = await app.request(`/callback?state=${flowId}&error=access_denied&error_description=User%20denied`)
      const statusRes = await app.request(`/status/${flowId}`)

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Authorization Failed')
      expect(await statusRes.json()).toEqual({ status: 'failed', error: 'User denied' })
    })

    it('returns 400 when the authorization code is missing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const app = createApp()
      const started = await startFlow(app, { clientId: 'client-123' })
      const { flowId } = await started.json() as { flowId: string }

      const res = await app.request(`/callback?state=${flowId}`)
      const statusRes = await app.request(`/status/${flowId}`)

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Missing Code')
      expect(await statusRes.json()).toEqual({ status: 'failed', error: 'No authorization code received' })
    })

    it('returns 400 for an unknown or expired state', async () => {
      const res = await createApp().request('/callback?code=abc&state=unknown-state')

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Session Expired')
    })

    it('returns 500 when the token exchange responds with an error', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const app = createApp()
      const started = await startFlow(app, { clientId: 'client-123' })
      const { flowId } = await started.json() as { flowId: string }
      fetchMock.mockResolvedValueOnce(textResponse('invalid_grant', 400))

      const res = await app.request(`/callback?code=auth-code&state=${flowId}`)
      const statusRes = await app.request(`/status/${flowId}`)

      expect(res.status).toBe(500)
      expect(await res.text()).toContain('Token Exchange Failed')
      expect(await statusRes.json()).toEqual({ status: 'failed', error: 'Token exchange failed' })
    })

    it('returns 500 when the token exchange request throws', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const app = createApp()
      const started = await startFlow(app, { clientId: 'client-123' })
      const { flowId } = await started.json() as { flowId: string }
      fetchMock.mockRejectedValueOnce(new Error('token endpoint down'))

      const res = await app.request(`/callback?code=auth-code&state=${flowId}`)
      const statusRes = await app.request(`/status/${flowId}`)

      expect(res.status).toBe(500)
      expect(await res.text()).toContain('Unexpected Error')
      expect(await statusRes.json()).toEqual({ status: 'failed', error: 'Unexpected error during token exchange' })
    })

    it('writes tokens to mcp-auth.json and reconnects with the directory', async () => {
      const forward = vi.fn(async () => new Response('{}', { status: 200 }))
      const app = createApp(createStubOpenCodeClient({ forward }))
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const started = await startFlow(app, { clientId: 'client-123', directory: '/tmp/project' })
      const { flowId } = await started.json() as { flowId: string }
      const before = Math.floor(Date.now() / 1000)
      fetchMock.mockResolvedValueOnce(jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'read write',
        token_type: 'Bearer',
      }))

      const res = await app.request(`/callback?code=auth-code&state=${flowId}`)
      const auth = await readAuthFile()
      const statusRes = await app.request(`/status/${flowId}`)

      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Authentication Successful')
      expect(auth['my-server']!.serverUrl).toBe(SERVER_URL)
      expect(auth['my-server']!.tokens.accessToken).toBe('access-token')
      expect(auth['my-server']!.tokens.refreshToken).toBe('refresh-token')
      expect(auth['my-server']!.tokens.scope).toBe('read write')
      expect(auth['my-server']!.tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600)
      expect(auth['my-server']!.clientInfo).toEqual({ clientId: 'client-123' })
      expect(forward).toHaveBeenCalledTimes(2)
      expect(forward).toHaveBeenNthCalledWith(1, {
        method: 'POST',
        path: '/mcp/my-server/connect',
        directory: '/tmp/project',
      })
      expect(forward).toHaveBeenNthCalledWith(2, {
        method: 'POST',
        path: '/mcp/my-server/connect',
      })
      expect(await statusRes.json()).toEqual({ status: 'completed', serverName: 'my-server' })
    })

    it('merges tokens into an existing mcp-auth.json without dropping other servers', async () => {
      await mkdir(dirname(MCP_AUTH_PATH), { recursive: true })
      await writeFile(MCP_AUTH_PATH, JSON.stringify({ existing: { serverUrl: 'https://old.example.com' } }))
      const app = createApp()
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const started = await startFlow(app, { clientId: 'client-123' })
      const { flowId } = await started.json() as { flowId: string }
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'access-token' }))

      const res = await app.request(`/callback?code=auth-code&state=${flowId}`)
      const auth = await readAuthFile()

      expect(res.status).toBe(200)
      expect(auth.existing).toEqual({ serverUrl: 'https://old.example.com' })
      expect(auth['my-server']!.tokens.accessToken).toBe('access-token')
      expect(auth['my-server']!.tokens.expiresAt).toBeUndefined()
    })

    it('still reports success when the reconnect trigger fails', async () => {
      const forward = vi.fn(async () => {
        throw new Error('reconnect failed')
      })
      const app = createApp(createStubOpenCodeClient({ forward }))
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))
      const started = await startFlow(app, { clientId: 'client-123' })
      const { flowId } = await started.json() as { flowId: string }
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'access-token' }))

      const res = await app.request(`/callback?code=auth-code&state=${flowId}`)

      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Authentication Successful')
      expect(forward).toHaveBeenCalledTimes(1)
    })

    it('sends the client secret during token exchange when one was registered', async () => {
      const app = createApp()
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryMetadata({ registration_endpoint: REGISTRATION_ENDPOINT })))
        .mockResolvedValueOnce(jsonResponse({ client_id: 'dynamic-client', client_secret: 'dynamic-secret' }))
      const started = await startFlow(app)
      const { flowId } = await started.json() as { flowId: string }
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'access-token' }))

      const res = await app.request(`/callback?code=auth-code&state=${flowId}`)
      const tokenCall = fetchMock.mock.calls[2]!
      const tokenInit = tokenCall[1] as RequestInit
      const params = tokenInit.body as URLSearchParams

      expect(res.status).toBe(200)
      expect(tokenCall[0]).toBe(TOKEN_ENDPOINT)
      expect(params.get('grant_type')).toBe('authorization_code')
      expect(params.get('client_id')).toBe('dynamic-client')
      expect(params.get('client_secret')).toBe('dynamic-secret')
      expect(params.get('code')).toBe('auth-code')
      expect(params.get('code_verifier')).toBeTruthy()
      expect(params.get('redirect_uri')).toBe('http://localhost:5003/api/mcp-oauth-proxy/callback')
    })
  })

  describe('requireAuth middleware', () => {
    const denyAuth: MiddlewareHandler = async (c) => c.json({ error: 'unauthorized' }, 401)
    const allowAuth: MiddlewareHandler = async (c, next) => {
      await next()
    }

    it('protects /start and /status but not /callback when the middleware rejects', async () => {
      const app = createApp(createStubOpenCodeClient(), denyAuth)

      const startRes = await startFlow(app)
      const statusRes = await app.request('/status/anything')
      const callbackRes = await app.request('/callback')

      expect(startRes.status).toBe(401)
      expect(statusRes.status).toBe(401)
      expect(callbackRes.status).toBe(400)
    })

    it('allows requests through when the middleware calls next', async () => {
      const app = createApp(createStubOpenCodeClient(), allowAuth)
      fetchMock.mockResolvedValueOnce(jsonResponse(discoveryMetadata()))

      const res = await startFlow(app, { clientId: 'client-123' })

      expect(res.status).toBe(200)
    })
  })
})
