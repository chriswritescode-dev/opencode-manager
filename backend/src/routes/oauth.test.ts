import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createOAuthRoutes } from './oauth'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { FetchOpenCodeClient } from '../services/opencode/client'
import { resolveOpenCode2Binary, startOpenCodeServe } from '../../test/helpers/opencode-binary'
import { buildOpenCodeBasicAuth, ClientError } from '@opencode-manager/shared/opencode'
import type { IntegrationInfo, IntegrationMethod } from '@opencode-manager/shared/opencode'
import type { OAuthAttemptStatus, OAuthAuthorizeResponse, ProviderAuthMethod } from '@opencode-manager/shared/schemas'
import type { OpenCodeClient } from '../services/opencode/client'

const restartMock = vi.hoisted(() => ({
  restartOpenCode: vi.fn(async () => ({ resumedSessionIDs: [] })),
  reloadOpenCodeConfig: vi.fn(async () => ({ resumedSessionIDs: [] })),
}))

vi.mock('../services/opencode-restart', () => ({
  restartOpenCode: restartMock.restartOpenCode,
  reloadOpenCodeConfig: restartMock.reloadOpenCodeConfig,
}))

const LOCATION = { directory: '/tmp/repo' }

function taggedError(tag: string, message: string): Error {
  return Object.assign(new Error(message), { _tag: tag })
}

function createOAuthApp(client: OpenCodeClient): Hono {
  const app = new Hono()
  app.route('/oauth', createOAuthRoutes(client))
  return app
}

function integrationFixture(overrides: Partial<IntegrationInfo> = {}): IntegrationInfo {
  return {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    methods: [],
    connections: [],
    ...overrides,
  }
}

function authorizeRequest(app: Hono, providerId = 'github-copilot', body: unknown = { methodID: 'device' }) {
  return app.request(`/oauth/${providerId}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function callbackRequest(app: Hono, providerId = 'github-copilot', body: unknown = { attemptID: 'con_stub' }) {
  return app.request(`/oauth/${providerId}/oauth/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('oauth routes /auth-methods', () => {
  const oauthMethod: IntegrationMethod = {
    id: 'device',
    type: 'oauth',
    label: 'Login with GitHub Copilot',
    form: [
      {
        key: 'deploymentType',
        title: 'Select GitHub deployment type',
        required: true,
        type: 'string',
        options: [
          { value: 'github.com', label: 'GitHub.com', description: 'Public' },
          { value: 'enterprise', label: 'GitHub Enterprise' },
        ],
      },
      {
        key: 'enterpriseUrl',
        title: 'Enter your GitHub Enterprise URL or domain',
        required: true,
        when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
        type: 'string',
        placeholder: 'company.ghe.com or https://company.ghe.com',
      },
    ],
  }

  const keyMethod: IntegrationMethod = {
    type: 'key',
    label: 'API key',
    form: [{ key: 'resourceName', type: 'string', title: 'Enter Azure Resource Name', required: true }],
  }

  const hiddenFieldMethod: IntegrationMethod = {
    id: 'device',
    type: 'oauth',
    label: 'OpenCode Console account',
    form: [{ key: 'server', type: 'string', format: 'uri', hidden: true, default: 'https://opencode.ai/console' }],
  }

  const commandMethod: IntegrationMethod = { id: 'browser', type: 'command', label: 'Login with DigitalOcean', command: ['doctl', 'auth', 'init'] }

  const envMethod: IntegrationMethod = { type: 'env', names: ['ANTHROPIC_API_KEY'] }

  it('normalizes V2 methods, forms, and conditions for every integration', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.list).mockResolvedValueOnce({
      location: LOCATION,
      data: [
        integrationFixture({ methods: [oauthMethod, envMethod] }),
        integrationFixture({ id: 'azure', name: 'Azure', methods: [keyMethod] }),
        integrationFixture({ id: 'opencode', name: 'OpenCode Console', methods: [hiddenFieldMethod] }),
        integrationFixture({ id: 'digitalocean', name: 'DigitalOcean', methods: [commandMethod] }),
      ],
    })

    const res = await createOAuthApp(client).request('/oauth/auth-methods')

    expect(res.status).toBe(200)
    const data = (await res.json()) as { providers: Record<string, unknown> }
    expect(data.providers).toEqual({
      'github-copilot': [
        {
          id: 'device',
          type: 'oauth',
          label: 'Login with GitHub Copilot',
          fields: [
            {
              type: 'select',
              key: 'deploymentType',
              message: 'Select GitHub deployment type',
              options: [
                { label: 'GitHub.com', value: 'github.com' },
                { label: 'GitHub Enterprise', value: 'enterprise' },
              ],
              required: true,
            },
            {
              type: 'text',
              key: 'enterpriseUrl',
              message: 'Enter your GitHub Enterprise URL or domain',
              placeholder: 'company.ghe.com or https://company.ghe.com',
              required: true,
              when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
            },
          ],
        },
        { id: 'env', type: 'env', label: 'ANTHROPIC_API_KEY' },
      ],
      azure: [
        {
          id: 'key',
          type: 'key',
          label: 'API key',
          fields: [
            {
              type: 'text',
              key: 'resourceName',
              message: 'Enter Azure Resource Name',
              required: true,
            },
          ],
        },
      ],
      opencode: [{ id: 'device', type: 'oauth', label: 'OpenCode Console account', fields: [] }],
      digitalocean: [{ id: 'browser', type: 'command', label: 'Login with DigitalOcean' }],
    })
  })

  it('returns 502 when the upstream is unreachable', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.list).mockRejectedValueOnce(new ClientError('UnexpectedStatus'))

    const res = await createOAuthApp(client).request('/oauth/auth-methods')

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Failed to get provider auth methods', code: 'ClientError' })
  })
})

describe('oauth routes /:id/oauth/authorize', () => {
  it('starts the V2 attempt with the method and answer and returns it', async () => {
    const client = createStubOpenCodeClient()
    const connect = vi.mocked(client.api.integration.oauth.connect)

    const res = await authorizeRequest(createOAuthApp(client), 'github-copilot', {
      methodID: 'device',
      answer: { deploymentType: 'github.com' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      attemptID: 'con_stub',
      url: 'https://example.com/authorize',
      instructions: 'Authorize in your browser',
      mode: 'auto',
    })
    expect(connect).toHaveBeenCalledWith({
      integrationID: 'github-copilot',
      methodID: 'device',
      answer: { deploymentType: 'github.com' },
    })
    expect(restartMock.restartOpenCode).not.toHaveBeenCalled()
    expect(restartMock.reloadOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid body', async () => {
    const client = createStubOpenCodeClient()

    const res = await authorizeRequest(createOAuthApp(client), 'github-copilot', { answer: {} })

    expect(res.status).toBe(400)
    expect(vi.mocked(client.api.integration.oauth.connect)).not.toHaveBeenCalled()
  })

  it('returns 502 with the upstream message when the answer is incomplete', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.connect).mockRejectedValueOnce(
      taggedError('InvalidRequestError', 'Missing required form field: deploymentType'),
    )

    const res = await authorizeRequest(createOAuthApp(client))

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'Missing required form field: deploymentType',
      code: 'InvalidRequestError',
    })
  })

  it('returns 404 when the integration is gone', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.connect).mockRejectedValueOnce(
      taggedError('IntegrationNotFoundError', 'Integration not found: github-copilot'),
    )

    const res = await authorizeRequest(createOAuthApp(client))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'Integration not found: github-copilot',
      code: 'IntegrationNotFoundError',
    })
  })
})

describe('oauth routes /:id/oauth/:attemptID', () => {
  it('reports a pending attempt', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.status).mockResolvedValueOnce({
      location: LOCATION,
      data: { status: 'pending', time: { created: 0, expires: 0 } },
    })

    const res = await createOAuthApp(client).request('/oauth/github-copilot/oauth/con_stub')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'pending' })
    expect(vi.mocked(client.api.integration.oauth.status)).toHaveBeenCalledWith({
      integrationID: 'github-copilot',
      attemptID: 'con_stub',
    })
  })

  it('reports a failed attempt with its message', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.status).mockResolvedValueOnce({
      location: LOCATION,
      data: { status: 'failed', message: 'Authorization denied', time: { created: 0, expires: 0 } },
    })

    const res = await createOAuthApp(client).request('/oauth/github-copilot/oauth/con_stub')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'failed', message: 'Authorization denied' })
  })

  it('returns 404 when the attempt is gone', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.status).mockRejectedValueOnce(
      taggedError('IntegrationAttemptNotFoundError', 'OAuth attempt not found: con_stub'),
    )

    const res = await createOAuthApp(client).request('/oauth/github-copilot/oauth/con_stub')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'OAuth attempt not found: con_stub',
      code: 'IntegrationAttemptNotFoundError',
    })
  })
})

describe('oauth routes /:id/oauth/callback', () => {
  it('completes the V2 attempt with the pasted code without restarting', async () => {
    const client = createStubOpenCodeClient()
    const complete = vi.mocked(client.api.integration.oauth.complete)

    const res = await callbackRequest(createOAuthApp(client), 'github-copilot', {
      attemptID: 'con_stub',
      code: 'pasted-code',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(complete).toHaveBeenCalledWith({
      integrationID: 'github-copilot',
      attemptID: 'con_stub',
      code: 'pasted-code',
    })
    expect(restartMock.restartOpenCode).not.toHaveBeenCalled()
    expect(restartMock.reloadOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid body', async () => {
    const client = createStubOpenCodeClient()

    const res = await callbackRequest(createOAuthApp(client), 'github-copilot', { code: 'pasted-code' })

    expect(res.status).toBe(400)
    expect(vi.mocked(client.api.integration.oauth.complete)).not.toHaveBeenCalled()
  })

  it('returns 404 when the attempt is gone', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.complete).mockRejectedValueOnce(
      taggedError('IntegrationAttemptNotFoundError', 'OAuth attempt not found: con_stub'),
    )

    const res = await callbackRequest(createOAuthApp(client))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'OAuth attempt not found: con_stub',
      code: 'IntegrationAttemptNotFoundError',
    })
  })

  it('returns 502 when the provider rejects the code', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.complete).mockRejectedValueOnce(
      taggedError('InvalidRequestError', 'Authorization code is required'),
    )

    const res = await callbackRequest(createOAuthApp(client), 'github-copilot', { attemptID: 'con_stub', code: 'bad' })

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'Authorization code is required',
      code: 'InvalidRequestError',
    })
  })
})

describe('oauth routes /:id/oauth/:attemptID delete', () => {
  it('cancels the V2 attempt without restarting', async () => {
    const client = createStubOpenCodeClient()
    const cancel = vi.mocked(client.api.integration.oauth.cancel)

    const res = await createOAuthApp(client).request('/oauth/github-copilot/oauth/con_stub', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(cancel).toHaveBeenCalledWith({ integrationID: 'github-copilot', attemptID: 'con_stub' })
    expect(restartMock.restartOpenCode).not.toHaveBeenCalled()
  })

  it('returns 502 when the upstream is unreachable', async () => {
    const client = createStubOpenCodeClient()
    vi.mocked(client.api.integration.oauth.cancel).mockRejectedValueOnce(new ClientError('UnexpectedStatus'))

    const res = await createOAuthApp(client).request('/oauth/github-copilot/oauth/con_stub', { method: 'DELETE' })

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Failed to cancel OAuth authorization', code: 'ClientError' })
  })
})

const openCodeBinary = resolveOpenCode2Binary()

describe.skipIf(!openCodeBinary)('oauth routes against a real OpenCode 2 server', () => {
  it('maps the real integration catalogue and starts and cancels an OAuth attempt', async () => {
    const serve = await startOpenCodeServe()
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = new Hono()
      app.route('/oauth', createOAuthRoutes(client))

      const methodsResponse = await app.request('/oauth/auth-methods')
      expect(methodsResponse.status).toBe(200)
      const { providers } = (await methodsResponse.json()) as {
        providers: Record<string, ProviderAuthMethod[]>
      }
      const device = providers['github-copilot']?.find((method) => method.id === 'device')
      expect(device?.fields?.map((field) => field.key)).toEqual(['deploymentType', 'enterpriseUrl'])
      expect(providers.opencode?.map((method) => method.id)).toEqual(['key', 'env', 'device'])
      expect(providers.azure?.find((method) => method.type === 'key')?.fields?.map((field) => field.key)).toEqual(['resourceName'])

      const authorizeResponse = await app.request('/oauth/github-copilot/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methodID: 'device', answer: { deploymentType: 'github.com' } }),
      })
      expect(authorizeResponse.status).toBe(200)
      const attempt = (await authorizeResponse.json()) as OAuthAuthorizeResponse
      expect(attempt.mode).toBe('auto')
      expect(attempt.url).toContain('github.com/login/device')

      const statusResponse = await app.request(`/oauth/github-copilot/oauth/${attempt.attemptID}`)
      expect(statusResponse.status).toBe(200)
      expect((await statusResponse.json()) as OAuthAttemptStatus).toEqual({ status: 'pending' })

      const cancelResponse = await app.request(`/oauth/github-copilot/oauth/${attempt.attemptID}`, {
        method: 'DELETE',
      })
      expect(cancelResponse.status).toBe(200)
      expect(await cancelResponse.json()).toEqual({ success: true })
    } finally {
      await serve.stop()
    }
  }, 120000)
})
