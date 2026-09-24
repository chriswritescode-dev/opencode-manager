import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createProvidersRoutes } from './providers'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { FetchOpenCodeClient } from '../services/opencode/client'
import { resolveOpenCode2Binary, startOpenCodeServe } from '../../test/helpers/opencode-binary'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { ClientError } from '@opencode-manager/shared/opencode'
import type { IntegrationInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../services/opencode/client'
import type { OpenCodeModelStateRecord } from '../services/opencode-model-state'

const modelStateMock = vi.hoisted(() => ({
  readOpenCodeModelState: vi.fn(),
  updateOpenCodeModelState: vi.fn(),
}))

vi.mock('../services/opencode-model-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/opencode-model-state')>()
  return {
    ...actual,
    readOpenCodeModelState: modelStateMock.readOpenCodeModelState,
    updateOpenCodeModelState: modelStateMock.updateOpenCodeModelState,
  }
})

const LOCATION = { directory: '/tmp/repo' }

function integrationFixture(overrides: Partial<IntegrationInfo> = {}): IntegrationInfo {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    methods: [{ type: 'key' }],
    connections: [],
    ...overrides,
  }
}

function credentialConnection(id: string) {
  return { type: 'credential' as const, id, label: 'Anthropic', method: 'key' as const }
}

function taggedError(tag: string, message: string): Error {
  return Object.assign(new Error(message), { _tag: tag })
}

function createTestApp(): Hono {
  const app = new Hono()
  app.route('/providers', createProvidersRoutes(createStubOpenCodeClient()))
  return app
}

function createCredentialApp(client: OpenCodeClient): Hono {
  const app = new Hono()
  app.route('/providers', createProvidersRoutes(client))
  return app
}

describe('providers routes', () => {
  let app: Hono
  let storedState: OpenCodeModelStateRecord

  beforeEach(() => {
    vi.clearAllMocks()
    storedState = { recent: [], favorite: [], variant: {} }
    modelStateMock.readOpenCodeModelState.mockImplementation(async () => storedState)
    modelStateMock.updateOpenCodeModelState.mockImplementation(
      async (mutate: (state: OpenCodeModelStateRecord) => OpenCodeModelStateRecord) => {
        storedState = mutate(storedState)
        return storedState
      },
    )
    app = createTestApp()
  })

  describe('GET /model-state', () => {
    it('returns the state owned by the service', async () => {
      const res = await app.request('/providers/model-state')
      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: unknown[]; favorite: unknown[]; variant: Record<string, unknown> }
      expect(data).toEqual({ recent: [], favorite: [], variant: {} })
      expect(modelStateMock.readOpenCodeModelState).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /model-state', () => {
    it('with recent returns 200 with recent[0] set', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recent: { providerID: 'anthropic', modelID: 'claude' } }),
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: Array<{ providerID: string; modelID: string }> }
      expect(data.recent).toHaveLength(1)
      expect(data.recent[0]).toEqual({ providerID: 'anthropic', modelID: 'claude' })
    })

    it('with removeRecent removes the model', async () => {
      storedState = {
        recent: [{ providerID: 'openai', modelID: 'gpt-4' }],
        favorite: [],
        variant: {},
      }

      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeRecent: { providerID: 'openai', modelID: 'gpt-4' } }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { recent: Array<{ providerID: string; modelID: string }> }
      expect(data.recent).toHaveLength(0)
    })

    it('with favorite toggles favorite (add then remove)', async () => {
      const body = { favorite: { providerID: 'openai', modelID: 'gpt-4' } }

      const res1 = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res1.status).toBe(200)
      const data1 = (await res1.json()) as { favorite: Array<{ providerID: string; modelID: string }> }
      expect(data1.favorite).toHaveLength(1)

      const res2 = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res2.status).toBe(200)
      const data2 = (await res2.json()) as { favorite: Array<{ providerID: string; modelID: string }> }
      expect(data2.favorite).toHaveLength(0)
    })

    it('with invalid body returns 400', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      })
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: string }
      expect(data.error).toBe('Invalid request data')
      expect(modelStateMock.updateOpenCodeModelState).not.toHaveBeenCalled()
    })

    it('returns 500 when the service rejects', async () => {
      modelStateMock.updateOpenCodeModelState.mockRejectedValueOnce(new Error('disk full'))

      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recent: { providerID: 'test', modelID: 'test' } }),
      })

      expect(res.status).toBe(500)
      const data = (await res.json()) as { error: string }
      expect(data.error).toBe('Failed to update OpenCode model state')
    })
  })

  describe('GET /credentials', () => {
    it('lists only integrations that hold a credential connection', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockResolvedValueOnce({
        location: LOCATION,
        data: [
          integrationFixture({ id: 'anthropic', connections: [credentialConnection('cred_1')] }),
          integrationFixture({ id: 'openai', connections: [{ type: 'env', name: 'OPENAI_API_KEY' }] }),
        ],
      })

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ providers: ['anthropic'] })
    })

    it('maps a declared upstream error to 502 with the upstream message', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockRejectedValueOnce(
        taggedError('UnknownError', 'upstream exploded'),
      )

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'upstream exploded' })
    })

    it('maps an unreachable upstream to 502', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockRejectedValueOnce(new ClientError('UnexpectedStatus'))

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'Failed to list provider credentials', code: 'ClientError' })
    })
  })

  describe('GET /:id/credentials/status', () => {
    it('reports true when the integration holds a credential connection', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.get).mockResolvedValueOnce({
        location: LOCATION,
        data: integrationFixture({ connections: [credentialConnection('cred_1')] }),
      })

      const res = await createCredentialApp(client).request('/providers/anthropic/credentials/status')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ hasCredentials: true })
    })

    it('reports false when the integration only has env connections', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.get).mockResolvedValueOnce({
        location: LOCATION,
        data: integrationFixture({ connections: [{ type: 'env', name: 'ANTHROPIC_API_KEY' }] }),
      })

      const res = await createCredentialApp(client).request('/providers/anthropic/credentials/status')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ hasCredentials: false })
    })

    it('returns 404 for a missing integration', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.get).mockRejectedValueOnce(
        taggedError('IntegrationNotFoundError', 'Integration not found: nope'),
      )

      const res = await createCredentialApp(client).request('/providers/nope/credentials/status')

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({
        error: 'Integration not found: nope',
        code: 'IntegrationNotFoundError',
      })
    })
  })

  describe('POST /:id/credentials', () => {
    function connectRequest(app: Hono, providerId = 'anthropic', body: unknown = { apiKey: 'sk-test' }) {
      return app.request(`/providers/${providerId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    it('connects the key through V2 integrations', async () => {
      const client = createStubOpenCodeClient()
      const connectKey = vi.mocked(client.api.integration.connect.key)

      const res = await connectRequest(createCredentialApp(client))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(connectKey).toHaveBeenCalledWith({ integrationID: 'anthropic', key: 'sk-test' })
    })

    it('forwards the form answer for key methods that declare required fields', async () => {
      const client = createStubOpenCodeClient()
      const connectKey = vi.mocked(client.api.integration.connect.key)

      const res = await connectRequest(createCredentialApp(client), 'azure', {
        apiKey: 'az-test',
        answer: { resourceName: 'my-models' },
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(connectKey).toHaveBeenCalledWith({
        integrationID: 'azure',
        key: 'az-test',
        answer: { resourceName: 'my-models' },
      })
    })

    it('returns 400 on an invalid body', async () => {
      const client = createStubOpenCodeClient()

      const res = await connectRequest(createCredentialApp(client), 'anthropic', {})

      expect(res.status).toBe(400)
      expect(vi.mocked(client.api.integration.connect.key)).not.toHaveBeenCalled()
    })

    it('retries once after a loading integration becomes available', async () => {
      const client = createStubOpenCodeClient()
      const connectKey = vi.mocked(client.api.integration.connect.key)
      connectKey.mockRejectedValueOnce(taggedError('IntegrationNotFoundError', 'Integration not found: anthropic'))

      const res = await connectRequest(createCredentialApp(client))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(connectKey).toHaveBeenCalledTimes(2)
      expect(vi.mocked(client.api.integration.get)).toHaveBeenCalledWith({ integrationID: 'anthropic' })
    })

    it('returns 404 for a missing integration', async () => {
      vi.useFakeTimers()
      try {
        const client = createStubOpenCodeClient()
        const notFound = taggedError('IntegrationNotFoundError', 'Integration not found: nope')
        vi.mocked(client.api.integration.connect.key).mockRejectedValue(notFound)
        vi.mocked(client.api.integration.get).mockRejectedValue(notFound)

        const pending = connectRequest(createCredentialApp(client), 'nope')
        await vi.runAllTimersAsync()
        const res = await pending

        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({
          error: 'Integration not found: nope',
          code: 'IntegrationNotFoundError',
        })
        expect(vi.mocked(client.api.integration.connect.key)).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns 502 when the key is rejected', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.connect.key).mockRejectedValueOnce(
        taggedError('InvalidRequestError', 'Missing required form field: account'),
      )

      const res = await connectRequest(createCredentialApp(client))

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({
        error: 'Missing required form field: account',
        code: 'InvalidRequestError',
      })
    })
  })

  describe('DELETE /:id/credentials', () => {
    it('removes every credential connection of the integration', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.get).mockResolvedValueOnce({
        location: LOCATION,
        data: integrationFixture({
          connections: [credentialConnection('cred_1'), credentialConnection('cred_2')],
        }),
      })
      const remove = vi.mocked(client.api.credential.remove)

      const res = await createCredentialApp(client).request('/providers/anthropic/credentials', { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(remove).toHaveBeenCalledTimes(2)
      expect(remove).toHaveBeenCalledWith({ credentialID: 'cred_1' })
      expect(remove).toHaveBeenCalledWith({ credentialID: 'cred_2' })
    })

    it('removes nothing when the integration has no credential connection', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.get).mockResolvedValueOnce({
        location: LOCATION,
        data: integrationFixture({ connections: [{ type: 'env', name: 'ANTHROPIC_API_KEY' }] }),
      })

      const res = await createCredentialApp(client).request('/providers/anthropic/credentials', { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(vi.mocked(client.api.credential.remove)).not.toHaveBeenCalled()
    })

    it('returns 404 for a missing integration', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.get).mockRejectedValueOnce(
        taggedError('IntegrationNotFoundError', 'Integration not found: nope'),
      )

      const res = await createCredentialApp(client).request('/providers/nope/credentials', { method: 'DELETE' })

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({
        error: 'Integration not found: nope',
        code: 'IntegrationNotFoundError',
      })
    })
  })
})

const openCodeBinary = resolveOpenCode2Binary()

describe.skipIf(!openCodeBinary)('providers routes against a real OpenCode 2 server', () => {
  it('connects an anthropic key and reports the credential', async () => {
    const serve = await startOpenCodeServe()
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = new Hono()
      app.route('/providers', createProvidersRoutes(client))

      await client.api.integration.list()

      const connectResponse = await app.request('/providers/anthropic/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-ant-binary-test' }),
      })
      expect(connectResponse.status).toBe(200)

      const statusResponse = await app.request('/providers/anthropic/credentials/status')
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual({ hasCredentials: true })

      const listResponse = await app.request('/providers/credentials')
      expect(listResponse.status).toBe(200)
      const { providers } = (await listResponse.json()) as { providers: string[] }
      expect(providers).toContain('anthropic')
    } finally {
      await serve.stop()
    }
  }, 120000)

  it('connects an azure key together with its required resourceName form field', async () => {
    const serve = await startOpenCodeServe()
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = new Hono()
      app.route('/providers', createProvidersRoutes(client))

      await client.api.integration.list()

      const rejected = await app.request('/providers/azure/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'az-binary-test' }),
      })
      expect(rejected.status).toBe(502)
      expect(await rejected.json()).toEqual({
        error: 'Missing required form field: resourceName',
        code: 'InvalidRequestError',
      })

      const connectResponse = await app.request('/providers/azure/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'az-binary-test', answer: { resourceName: 'my-models' } }),
      })
      expect(connectResponse.status).toBe(200)

      const statusResponse = await app.request('/providers/azure/credentials/status')
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual({ hasCredentials: true })
    } finally {
      await serve.stop()
    }
  }, 120000)
})
