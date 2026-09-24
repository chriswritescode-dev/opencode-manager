import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MiddlewareHandler } from 'hono'
import { createMcpOauthProxyRoutes } from '../../src/routes/mcp-oauth-proxy'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { resolveOpenCode2Binary, startOpenCodeServe } from '../helpers/opencode-binary'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const SERVER_NAME = 'my-server'
const INTEGRATION_ID = 'int-1'
const ATTEMPT_ID = 'att-1'
const AUTHORIZATION_URL = 'https://auth.example.com/authorize?client_id=client-1&state=state-1'
const CALLBACK_PATH = '/api/mcp-oauth-proxy/callback'

const realFetch = globalThis.fetch
const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))

function createApi(overrides: Record<string, unknown> = {}): OpenCodeApi {
  return {
    mcp: {
      list: vi.fn(async () => ({
        location: { directory: '/tmp/repo' },
        data: [{ name: SERVER_NAME, status: { status: 'needs_auth' as const }, integrationID: INTEGRATION_ID }],
      })),
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    },
    config: {
      get: vi.fn(async () => []),
    },
    integration: {
      get: vi.fn(async () => ({
        location: { directory: '/tmp/repo' },
        data: {
          id: INTEGRATION_ID,
          name: SERVER_NAME,
          methods: [{ id: 'method-1', type: 'oauth' as const, label: SERVER_NAME }],
          connections: [],
        },
      })),
      oauth: {
        connect: vi.fn(async () => ({
          location: { directory: '/tmp/repo' },
          data: {
            attemptID: ATTEMPT_ID,
            url: AUTHORIZATION_URL,
            instructions: 'Authorize in your browser',
            mode: 'auto' as const,
            time: { created: 0, expires: 0 },
          },
        })),
        status: vi.fn(async () => ({
          location: { directory: '/tmp/repo' },
          data: { status: 'pending' as const, time: { created: 0, expires: 0 } },
        })),
        complete: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
      },
    },
    credential: {
      remove: vi.fn(async () => undefined),
    },
    ...overrides,
  } as unknown as OpenCodeApi
}

function createClient(api: OpenCodeApi = createApi()): OpenCodeClient {
  return { ...createStubOpenCodeClient(), api }
}

function createApp(client: OpenCodeClient = createClient(), requireAuth?: MiddlewareHandler) {
  return createMcpOauthProxyRoutes(client, requireAuth)
}

async function startFlow(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return app.request('/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverName: SERVER_NAME, ...body }),
  })
}

describe('mcp oauth proxy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  describe('POST /start', () => {
    it('starts an integration OAuth attempt and returns its authorization URL', async () => {
      const api = createApi()
      const app = createApp(createClient(api))

      const res = await startFlow(app)
      const json = await res.json() as { authorizationUrl: string; flowId: string }

      expect(res.status).toBe(200)
      expect(json).toEqual({ authorizationUrl: AUTHORIZATION_URL, flowId: ATTEMPT_ID })
      expect(api.mcp.list).toHaveBeenCalledWith(undefined)
      expect(api.integration.get).toHaveBeenCalledWith({ integrationID: INTEGRATION_ID })
      expect(api.integration.oauth.connect).toHaveBeenCalledWith({
        integrationID: INTEGRATION_ID,
        methodID: 'method-1',
      })
    })

    it('scopes the V2 calls to the requested directory', async () => {
      const api = createApi({
        config: {
          get: vi.fn(async () => [
            {
              type: 'document' as const,
              path: '/tmp/project/opencode.json',
              info: {
                mcp: {
                  servers: {
                    [SERVER_NAME]: {
                      type: 'remote' as const,
                      url: 'https://mcp.example.com',
                      oauth: { redirect_uri: `http://localhost:5003${CALLBACK_PATH}` },
                    },
                  },
                },
              },
            },
          ]),
        },
      })
      const app = createApp(createClient(api))

      const res = await startFlow(app, { directory: '/tmp/project' })

      expect(res.status).toBe(200)
      expect(api.mcp.list).toHaveBeenCalledWith({ location: { directory: '/tmp/project' } })
      expect(api.config.get).toHaveBeenCalledWith({ location: { directory: '/tmp/project' } })
      expect(api.mcp.add).toHaveBeenCalledWith({
        server: SERVER_NAME,
        location: { directory: '/tmp/project' },
        config: {
          type: 'remote',
          url: 'https://mcp.example.com',
          oauth: {
            redirect_uri: `http://localhost:5003${CALLBACK_PATH}`,
            callback_port: expect.any(Number),
          },
        },
      })
      expect(api.integration.get).toHaveBeenCalledWith({
        integrationID: INTEGRATION_ID,
        location: { directory: '/tmp/project' },
      })
      expect(api.integration.oauth.connect).toHaveBeenCalledWith({
        integrationID: INTEGRATION_ID,
        methodID: 'method-1',
        location: { directory: '/tmp/project' },
      })
    })

    it('returns 404 when the MCP server is not registered', async () => {
      const api = createApi({
        mcp: {
          list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
          add: vi.fn(async () => undefined),
        },
      })

      const res = await startFlow(createApp(createClient(api)))
      const json = await res.json() as { error: string }

      expect(res.status).toBe(404)
      expect(json.error).toBe('MCP server not found')
    })

    it('returns 400 when the server has no OAuth integration', async () => {
      const api = createApi({
        mcp: {
          list: vi.fn(async () => ({
            location: { directory: '/tmp/repo' },
            data: [{ name: SERVER_NAME, status: { status: 'connected' as const } }],
          })),
          add: vi.fn(async () => undefined),
        },
      })

      const res = await startFlow(createApp(createClient(api)))
      const json = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('MCP server is not registered for OAuth')
    })

    it('returns 400 when the integration exposes no OAuth method', async () => {
      const api = createApi({
        integration: {
          get: vi.fn(async () => ({
            location: { directory: '/tmp/repo' },
            data: { id: INTEGRATION_ID, name: SERVER_NAME, methods: [], connections: [] },
          })),
          oauth: {
            connect: vi.fn(async () => {
              throw new Error('should not connect')
            }),
            status: vi.fn(),
            complete: vi.fn(),
            cancel: vi.fn(),
          },
        },
      })

      const res = await startFlow(createApp(createClient(api)))
      const json = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('OAuth method not found for this MCP server')
    })

    it('returns 500 when the authorization URL carries no state', async () => {
      const api = createApi({
        integration: {
          get: vi.fn(async () => ({
            location: { directory: '/tmp/repo' },
            data: {
              id: INTEGRATION_ID,
              name: SERVER_NAME,
              methods: [{ id: 'method-1', type: 'oauth' as const, label: SERVER_NAME }],
              connections: [],
            },
          })),
          oauth: {
            connect: vi.fn(async () => ({
              location: { directory: '/tmp/repo' },
              data: {
                attemptID: ATTEMPT_ID,
                url: 'https://auth.example.com/authorize',
                instructions: 'Authorize in your browser',
                mode: 'auto' as const,
                time: { created: 0, expires: 0 },
              },
            })),
            status: vi.fn(),
            complete: vi.fn(),
            cancel: vi.fn(),
          },
        },
      })

      const res = await startFlow(createApp(createClient(api)))
      const json = await res.json() as { error: string }

      expect(res.status).toBe(500)
      expect(json.error).toBe('Authorization URL is missing the state parameter')
    })

    it('returns 500 when the request body is not valid JSON', async () => {
      const res = await createApp().request('/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })

      expect(res.status).toBe(500)
    })

    it('reserves a free loopback port and keeps the Manager callback', async () => {
      const api = createApi({
        config: {
          get: vi.fn(async () => [
            {
              type: 'document' as const,
              path: '/tmp/repo/opencode.json',
              info: {
                mcp: {
                  servers: {
                    [SERVER_NAME]: {
                      type: 'remote' as const,
                      url: 'https://mcp.example.com',
                      oauth: { redirect_uri: `http://localhost:5003${CALLBACK_PATH}` },
                    },
                  },
                },
              },
            },
          ]),
        },
      })
      const app = createApp(createClient(api))

      const res = await startFlow(app)

      expect(res.status).toBe(200)
      expect(api.mcp.add).toHaveBeenCalledWith({
        server: SERVER_NAME,
        config: {
          type: 'remote',
          url: 'https://mcp.example.com',
          oauth: {
            redirect_uri: `http://localhost:5003${CALLBACK_PATH}`,
            callback_port: expect.any(Number),
          },
        },
      })
      expect(api.mcp.list).toHaveBeenCalledTimes(1)
    })

    it('ignores config entries that are not remote OAuth servers', async () => {
      const api = createApi({
        config: {
          get: vi.fn(async () => [
            {
              type: 'document' as const,
              path: '/tmp/repo/opencode.json',
              info: {
                mcp: {
                  servers: {
                    [SERVER_NAME]: { type: 'local' as const, command: ['npx', 'server'] },
                  },
                },
              },
            },
          ]),
        },
      })
      const app = createApp(createClient(api))

      const res = await startFlow(app)

      expect(res.status).toBe(200)
      expect(api.mcp.add).not.toHaveBeenCalled()
    })
  })

  describe('GET /status/:flowId', () => {
    it('returns unknown for an attempt that was never started here', async () => {
      const res = await createApp().request('/status/unknown-attempt')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'unknown' })
    })

    it('maps a pending attempt to pending', async () => {
      const api = createApi()
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/status/${ATTEMPT_ID}`)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'pending' })
      expect(api.integration.oauth.status).toHaveBeenCalledWith({
        integrationID: INTEGRATION_ID,
        attemptID: ATTEMPT_ID,
      })
    })

    it('maps a complete attempt to completed with the server name', async () => {
      const api = createApi({
        integration: {
          get: createApi().integration.get,
          oauth: {
            connect: createApi().integration.oauth.connect,
            status: vi.fn(async () => ({
              location: { directory: '/tmp/repo' },
              data: { status: 'complete' as const, time: { created: 0, expires: 0 } },
            })),
            complete: vi.fn(async () => undefined),
            cancel: vi.fn(async () => undefined),
          },
        },
      })
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/status/${ATTEMPT_ID}`)

      expect(await res.json()).toEqual({ status: 'completed', serverName: SERVER_NAME })
    })

    it('maps a failed attempt to failed with its message', async () => {
      const api = createApi({
        integration: {
          get: createApi().integration.get,
          oauth: {
            connect: createApi().integration.oauth.connect,
            status: vi.fn(async () => ({
              location: { directory: '/tmp/repo' },
              data: { status: 'failed' as const, message: 'token exchange failed', time: { created: 0, expires: 0 } },
            })),
            complete: vi.fn(async () => undefined),
            cancel: vi.fn(async () => undefined),
          },
        },
      })
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/status/${ATTEMPT_ID}`)

      expect(await res.json()).toEqual({ status: 'failed', error: 'token exchange failed' })
    })

    it('maps an expired attempt to failed', async () => {
      const api = createApi({
        integration: {
          get: createApi().integration.get,
          oauth: {
            connect: createApi().integration.oauth.connect,
            status: vi.fn(async () => ({
              location: { directory: '/tmp/repo' },
              data: { status: 'expired' as const, time: { created: 0, expires: 0 } },
            })),
            complete: vi.fn(async () => undefined),
            cancel: vi.fn(async () => undefined),
          },
        },
      })
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/status/${ATTEMPT_ID}`)

      expect(await res.json()).toEqual({ status: 'failed', error: 'Authorization expired' })
    })
  })

  describe('GET /callback', () => {
    it('returns 400 when the state parameter is missing', async () => {
      const res = await createApp().request('/callback?code=abc')

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Missing State')
    })

    it('returns 400 for an unknown or expired state', async () => {
      const res = await createApp().request('/callback?code=abc&state=unknown-state')

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Session Expired')
    })

    it('forwards the code and state to the attempt loopback listener', async () => {
      const api = createApi()
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/callback?code=auth-code&state=state-1`)
      const forwarded = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))

      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Authentication Successful')
      expect(forwarded.protocol).toBe('http:')
      expect(forwarded.hostname).toBe('127.0.0.1')
      expect(forwarded.port).toMatch(/^\d+$/)
      expect(forwarded.pathname).toBe(CALLBACK_PATH)
      expect(forwarded.searchParams.get('code')).toBe('auth-code')
      expect(forwarded.searchParams.get('state')).toBe('state-1')
      expect(forwarded.searchParams.has('iss')).toBe(false)
    })

    it('forwards the iss parameter unchanged when the provider sends one', async () => {
      const api = createApi()
      const app = createApp(createClient(api))
      await startFlow(app)

      const issuer = 'https://auth.example.com/tenant/one'
      const res = await app.request(`/callback?code=auth-code&state=state-1&iss=${encodeURIComponent(issuer)}`)
      const forwarded = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))

      expect(res.status).toBe(200)
      expect(forwarded.searchParams.get('iss')).toBe(issuer)
      expect(String(forwarded)).toContain(`iss=${encodeURIComponent(issuer)}`)
    })

    it('forwards an iss parameter the provider did not require', async () => {
      const api = createApi()
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/callback?code=auth-code&state=state-1&iss=${encodeURIComponent('https://other.example.com')}`)
      const forwarded = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))

      expect(res.status).toBe(200)
      expect(forwarded.searchParams.get('iss')).toBe('https://other.example.com')
    })

    it('cancels the attempt and fails when the provider reports an error', async () => {
      const api = createApi()
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/callback?state=state-1&error=access_denied&error_description=User%20denied`)

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Authorization Failed')
      expect(api.integration.oauth.cancel).toHaveBeenCalledWith({
        integrationID: INTEGRATION_ID,
        attemptID: ATTEMPT_ID,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('cancels the attempt when the authorization code is missing', async () => {
      const api = createApi()
      const app = createApp(createClient(api))
      await startFlow(app)

      const res = await app.request(`/callback?state=state-1`)

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Missing Code')
      expect(api.integration.oauth.cancel).toHaveBeenCalledWith({
        integrationID: INTEGRATION_ID,
        attemptID: ATTEMPT_ID,
      })
    })

    it('renders a failure page when the loopback listener rejects the code', async () => {
      fetchMock.mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }))
      const app = createApp()
      await startFlow(app)

      const res = await app.request(`/callback?code=auth-code&state=state-1`)

      expect(res.status).toBe(400)
      expect(await res.text()).toContain('Authentication Failed')
    })

    it('renders a failure page when the loopback listener is unreachable', async () => {
      fetchMock.mockRejectedValueOnce(new Error('connection refused'))
      const app = createApp()
      await startFlow(app)

      const res = await app.request(`/callback?code=auth-code&state=state-1`)

      expect(res.status).toBe(500)
      expect(await res.text()).toContain('Authentication Failed')
    })

    it('consumes the state so a replayed callback is rejected', async () => {
      const app = createApp()
      await startFlow(app)
      await app.request(`/callback?code=auth-code&state=state-1`)

      const replay = await app.request(`/callback?code=auth-code&state=state-1`)

      expect(replay.status).toBe(400)
      expect(await replay.text()).toContain('Session Expired')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('forwards to the loopback listener of the directory-scoped attempt', async () => {
      const api = createApi()
      const app = createApp(createClient(api))
      await startFlow(app, { directory: '/tmp/project' })

      const res = await app.request(`/callback?code=auth-code&state=state-1`)
      const forwarded = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))

      expect(res.status).toBe(200)
      expect(forwarded.pathname).toBe(CALLBACK_PATH)
      expect(forwarded.searchParams.get('state')).toBe('state-1')
    })

    it('keeps the callback reachable without the Manager auth middleware', async () => {
      const api = createApi()
      const denyExceptStart: MiddlewareHandler = async (c, next) => {
        if (c.req.path === '/start') {
          return next()
        }
        return c.json({ error: 'unauthorized' }, 401)
      }
      const app = createApp(createClient(api), denyExceptStart)
      await startFlow(app)

      const callbackRes = await app.request(`/callback?code=auth-code&state=state-1`)
      const statusRes = await app.request(`/status/${ATTEMPT_ID}`)
      const credentialsRes = await app.request(`/credentials/${SERVER_NAME}`, { method: 'DELETE' })

      expect(statusRes.status).toBe(401)
      expect(credentialsRes.status).toBe(401)
      expect(callbackRes.status).toBe(200)
      expect(await callbackRes.text()).toContain('Authentication Successful')
    })
  })

  describe('DELETE /credentials/:serverName', () => {
    it('removes every credential connection of the server integration', async () => {
      const api = createApi({
        integration: {
          get: vi.fn(async () => ({
            location: { directory: '/tmp/repo' },
            data: {
              id: INTEGRATION_ID,
              name: SERVER_NAME,
              methods: [],
              connections: [
                { type: 'credential' as const, id: 'cred-1', label: 'one', method: 'oauth' as const },
                { type: 'credential' as const, id: 'cred-2', label: 'two', method: 'oauth' as const },
                { type: 'env' as const, name: 'API_KEY' },
              ],
            },
          })),
          oauth: createApi().integration.oauth,
        },
      })
      const app = createApp(createClient(api))

      const res = await app.request(`/credentials/${SERVER_NAME}`, { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(api.credential.remove).toHaveBeenCalledTimes(2)
      expect(api.credential.remove).toHaveBeenNthCalledWith(1, { credentialID: 'cred-1' })
      expect(api.credential.remove).toHaveBeenNthCalledWith(2, { credentialID: 'cred-2' })
    })

    it('scopes the lookup to the requested directory', async () => {
      const api = createApi()
      const app = createApp(createClient(api))

      const res = await app.request(`/credentials/${SERVER_NAME}?directory=/tmp/project`, { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(api.mcp.list).toHaveBeenCalledWith({ location: { directory: '/tmp/project' } })
      expect(api.integration.get).toHaveBeenCalledWith({
        integrationID: INTEGRATION_ID,
        location: { directory: '/tmp/project' },
      })
    })

    it('succeeds when the server is unknown', async () => {
      const api = createApi({
        mcp: {
          list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
          add: vi.fn(async () => undefined),
        },
      })
      const app = createApp(createClient(api))

      const res = await app.request(`/credentials/${SERVER_NAME}`, { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(api.credential.remove).not.toHaveBeenCalled()
    })

    it('succeeds when the server has no OAuth integration', async () => {
      const api = createApi({
        mcp: {
          list: vi.fn(async () => ({
            location: { directory: '/tmp/repo' },
            data: [{ name: SERVER_NAME, status: { status: 'connected' as const } }],
          })),
          add: vi.fn(async () => undefined),
        },
      })
      const app = createApp(createClient(api))

      const res = await app.request(`/credentials/${SERVER_NAME}`, { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(api.integration.get).not.toHaveBeenCalled()
    })
  })

  describe('requireAuth middleware', () => {
    const denyAuth: MiddlewareHandler = async (c) => c.json({ error: 'unauthorized' }, 401)

    it('protects every route except the callback', async () => {
      const app = createApp(createClient(), denyAuth)

      const startRes = await startFlow(app)
      const statusRes = await app.request(`/status/${ATTEMPT_ID}`)
      const credentialsRes = await app.request(`/credentials/${SERVER_NAME}`, { method: 'DELETE' })
      const callbackRes = await app.request('/callback')

      expect(startRes.status).toBe(401)
      expect(statusRes.status).toBe(401)
      expect(credentialsRes.status).toBe(401)
      expect(callbackRes.status).toBe(400)
    })
  })
})

function listenOnLoopback(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function closeLoopback(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

async function startFakeMcpOAuthServer(options: { issuerSupport?: boolean } = {}): Promise<{
  origin: string
  mcpUrl: string
  requests: string[]
  stop: () => Promise<void>
}> {
  const requests: string[] = []
  const server = createServer((req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    requests.push(`${req.method} ${req.url}`)
    const url = new URL(req.url ?? '/', origin)
    const json = (body: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return json({ resource: `${origin}/mcp`, authorization_servers: [origin] })
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        ...(options.issuerSupport ? { authorization_response_iss_parameter_supported: true } : {}),
      })
    }
    if (url.pathname === '/register') {
      return json({ client_id: 'test-client', redirect_uris: [`${origin}/callback`] })
    }
    if (url.pathname === '/token') {
      return json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    })
    res.end(JSON.stringify({ error: 'unauthorized' }))
  })

  const port = await listenOnLoopback(server)
  const origin = `http://127.0.0.1:${port}`
  return { origin, mcpUrl: `${origin}/mcp`, requests, stop: () => closeLoopback(server) }
}

const openCodeBinary = resolveOpenCode2Binary()

type McpServerSummary = { name: string; status: { status: string }; integrationID?: string }

async function waitForMcpServer(
  client: OpenCodeClient,
  location: { location: { directory: string } } | undefined,
  predicate: (server: McpServerSummary) => boolean,
): Promise<McpServerSummary> {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const server = (await client.api.mcp.list(location)).data.find((candidate) => candidate.name === SERVER_NAME)
      if (server && predicate(server)) return server
    } catch {
      // the server may still be starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`MCP server ${SERVER_NAME} did not reach the expected state`)
}

describe.skipIf(!openCodeBinary)('mcp oauth proxy routes against a real OpenCode 2 server', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', realFetch)
  })

  it('completes the attempt through the loopback listener and stores the credential in V2', async () => {
    const fake = await startFakeMcpOAuthServer()
    const workspace = await mkdtemp(path.join(tmpdir(), 'ocm-mcp-oauth-'))
    const configPath = path.join(workspace, '.config', 'opencode', 'opencode.json')

    const serve = await startOpenCodeServe({ env: { XDG_CONFIG_HOME: path.join(workspace, '.config') } })
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = createApp(client)

      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(
        configPath,
        JSON.stringify({
          mcp: {
            servers: {
              [SERVER_NAME]: {
                type: 'remote',
                url: fake.mcpUrl,
                oauth: { redirect_uri: `http://localhost:5003${CALLBACK_PATH}` },
              },
            },
          },
        }),
      )

      await waitForMcpServer(client, undefined, () => true)

      const startRes = await startFlow(app)
      const started = (await startRes.json()) as { authorizationUrl: string; flowId: string }
      expect(startRes.status).toBe(200)

      const authorizationUrl = new URL(started.authorizationUrl)
      expect(authorizationUrl.searchParams.get('state')).toBeTruthy()
      expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(`http://localhost:5003${CALLBACK_PATH}`)

      const state = authorizationUrl.searchParams.get('state')!
      const callbackRes = await app.request(`/callback?code=auth-code&state=${state}`)
      expect(callbackRes.status).toBe(200)
      expect(await callbackRes.text()).toContain('Authentication Successful')

      const listed = await waitForMcpServer(client, undefined, (server) => server.status.status !== 'needs_auth')

      const integration = (await client.api.integration.get({ integrationID: listed.integrationID! })).data
      expect(integration.connections.some((connection) => connection.type === 'credential')).toBe(true)
    } finally {
      await fake.stop()
      await serve.stop()
    }
  }, 180000)

  it('completes repository-scoped OAuth without touching a same-name default-location server', async () => {
    const repoFake = await startFakeMcpOAuthServer()
    const defaultFake = await startFakeMcpOAuthServer()
    const workspace = await mkdtemp(path.join(tmpdir(), 'ocm-mcp-oauth-repo-'))
    const configPath = path.join(workspace, '.config', 'opencode', 'opencode.json')
    const repoDirectory = path.join(workspace, 'repo')

    const serve = await startOpenCodeServe({ env: { XDG_CONFIG_HOME: path.join(workspace, '.config') } })
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = createApp(client)

      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(
        configPath,
        JSON.stringify({
          mcp: {
            servers: {
              [SERVER_NAME]: {
                type: 'remote',
                url: defaultFake.mcpUrl,
                oauth: { redirect_uri: `http://localhost:5003${CALLBACK_PATH}` },
              },
            },
          },
        }),
      )
      await mkdir(repoDirectory, { recursive: true })
      await writeFile(
        path.join(repoDirectory, 'opencode.json'),
        JSON.stringify({
          mcp: {
            servers: {
              [SERVER_NAME]: {
                type: 'remote',
                url: repoFake.mcpUrl,
                oauth: { redirect_uri: `http://localhost:5003${CALLBACK_PATH}` },
              },
            },
          },
        }),
      )

      const repoLocation = { location: { directory: repoDirectory } }
      const defaultServer = await waitForMcpServer(client, undefined, (server) => server.status.status !== 'pending')
      await waitForMcpServer(client, repoLocation, () => true)

      const startRes = await startFlow(app, { directory: repoDirectory })
      const started = (await startRes.json()) as { authorizationUrl: string; flowId: string }
      expect(startRes.status).toBe(200)

      const authorizationUrl = new URL(started.authorizationUrl)
      const state = authorizationUrl.searchParams.get('state')!
      expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(`http://localhost:5003${CALLBACK_PATH}`)

      const callbackRes = await app.request(`/callback?code=auth-code&state=${state}`)
      expect(callbackRes.status).toBe(200)
      expect(await callbackRes.text()).toContain('Authentication Successful')

      const repoServer = await waitForMcpServer(client, repoLocation, (server) => server.status.status !== 'needs_auth')
      const repoIntegration = (
        await client.api.integration.get({ integrationID: repoServer.integrationID!, ...repoLocation })
      ).data
      expect(repoIntegration.connections.some((connection) => connection.type === 'credential')).toBe(true)

      const defaultAfter = (await client.api.mcp.list()).data.find((server) => server.name === SERVER_NAME)
      expect(defaultAfter?.integrationID).toBe(defaultServer.integrationID)
      expect(defaultAfter?.status.status).toBe('needs_auth')
      const defaultIntegration = (
        await client.api.integration.get({ integrationID: defaultServer.integrationID! })
      ).data
      expect(defaultIntegration.connections.some((connection) => connection.type === 'credential')).toBe(false)
    } finally {
      await repoFake.stop()
      await defaultFake.stop()
      await serve.stop()
    }
  }, 180000)

  it('completes an attempt whose callback carries the matching issuer', async () => {
    const fake = await startFakeMcpOAuthServer({ issuerSupport: true })
    const workspace = await mkdtemp(path.join(tmpdir(), 'ocm-mcp-oauth-iss-'))
    const configPath = path.join(workspace, '.config', 'opencode', 'opencode.json')

    const serve = await startOpenCodeServe({ env: { XDG_CONFIG_HOME: path.join(workspace, '.config') } })
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = createApp(client)

      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(
        configPath,
        JSON.stringify({
          mcp: {
            servers: {
              [SERVER_NAME]: {
                type: 'remote',
                url: fake.mcpUrl,
                oauth: { redirect_uri: `http://localhost:5003${CALLBACK_PATH}` },
              },
            },
          },
        }),
      )

      await waitForMcpServer(client, undefined, () => true)

      const startRes = await startFlow(app)
      const started = (await startRes.json()) as { authorizationUrl: string; flowId: string }
      expect(startRes.status).toBe(200)

      const authorizationUrl = new URL(started.authorizationUrl)
      const state = authorizationUrl.searchParams.get('state')!
      const callbackRes = await app.request(
        `/callback?code=auth-code&state=${state}&iss=${encodeURIComponent(fake.origin)}`,
      )
      expect(callbackRes.status).toBe(200)
      expect(await callbackRes.text()).toContain('Authentication Successful')

      const listed = await waitForMcpServer(client, undefined, (server) => server.status.status !== 'needs_auth')

      const integration = (await client.api.integration.get({ integrationID: listed.integrationID! })).data
      expect(integration.connections.some((connection) => connection.type === 'credential')).toBe(true)
    } finally {
      await fake.stop()
      await serve.stop()
    }
  }, 180000)

  it('rejects a mismatched issuer without storing a credential', async () => {
    const fake = await startFakeMcpOAuthServer({ issuerSupport: true })
    const workspace = await mkdtemp(path.join(tmpdir(), 'ocm-mcp-oauth-iss-mismatch-'))
    const configPath = path.join(workspace, '.config', 'opencode', 'opencode.json')

    const serve = await startOpenCodeServe({ env: { XDG_CONFIG_HOME: path.join(workspace, '.config') } })
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = createApp(client)

      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(
        configPath,
        JSON.stringify({
          mcp: {
            servers: {
              [SERVER_NAME]: {
                type: 'remote',
                url: fake.mcpUrl,
                oauth: { redirect_uri: `http://localhost:5003${CALLBACK_PATH}` },
              },
            },
          },
        }),
      )

      await waitForMcpServer(client, undefined, () => true)

      const startRes = await startFlow(app)
      const started = (await startRes.json()) as { authorizationUrl: string; flowId: string }
      expect(startRes.status).toBe(200)

      const authorizationUrl = new URL(started.authorizationUrl)
      const state = authorizationUrl.searchParams.get('state')!
      const callbackRes = await app.request(
        `/callback?code=auth-code&state=${state}&iss=${encodeURIComponent('https://other.example.com')}`,
      )
      expect(callbackRes.status).toBe(200)

      const statusDeadline = Date.now() + 15000
      let status = 'unknown'
      while (Date.now() < statusDeadline && status !== 'failed') {
        const statusRes = await app.request(`/status/${started.flowId}`)
        status = ((await statusRes.json()) as { status: string }).status
        if (status !== 'failed') await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(status).toBe('failed')

      const listed = (await client.api.mcp.list()).data.find((server) => server.name === SERVER_NAME)
      expect(listed?.status.status).toBe('needs_auth')
      const integration = (await client.api.integration.get({ integrationID: listed!.integrationID! })).data
      expect(integration.connections.some((connection) => connection.type === 'credential')).toBe(false)
    } finally {
      await fake.stop()
      await serve.stop()
    }
  }, 180000)
})
