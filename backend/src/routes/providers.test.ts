import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { createProvidersRoutes } from './providers'
import { createOAuthRoutes } from './oauth'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { FetchOpenCodeClient } from '../services/opencode/client'
import {
  createOpenCodeServeDirectories,
  readOpenCodeVersion,
  resolveOpenCode2Binary,
  startOpenCodeServe,
  type OpenCodeServe,
  type OpenCodeServeDirectories,
} from '../../test/helpers/opencode-binary'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { ClientError } from '@opencode-manager/shared/opencode'
import { compareSemver } from '@opencode-manager/shared/utils'
import type { IntegrationInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../services/opencode/client'
import type { ModelPreferenceDocument } from '@opencode-manager/shared/opencode'

const modelStatePaths = vi.hoisted(() => ({ file: '' }))

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return {
    ...actual,
    getOpenCodeModelStatePath: () => modelStatePaths.file,
  }
})

const modelStateMock = vi.hoisted(() => ({
  readOpenCodeModelState: vi.fn(),
  updateOpenCodeModelState: vi.fn(),
  actual: undefined as unknown,
}))

vi.mock('../services/opencode-model-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/opencode-model-state')>()
  modelStateMock.actual = actual
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

function credentialFixture(integrationID: string, id = `cred_${integrationID}`) {
  return {
    id,
    integrationID,
    label: 'Anthropic',
    active: true,
    value: { type: 'key' as const, key: 'sk-test' },
  }
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
  let storedState: ModelPreferenceDocument

  beforeEach(() => {
    vi.clearAllMocks()
    storedState = { recent: [], favorite: [], variant: {} }
    modelStateMock.readOpenCodeModelState.mockImplementation(async () => storedState)
    modelStateMock.updateOpenCodeModelState.mockImplementation(
      async (mutate: (state: ModelPreferenceDocument) => ModelPreferenceDocument) => {
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

    it('with variant persists the named variant', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variant: { model: { providerID: 'anthropic', modelID: 'claude' }, value: 'high' },
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { variant: Record<string, string | undefined> }
      expect(data.variant).toEqual({ 'anthropic/claude': 'high' })
    })

    it('with variant value omitted or null persists default', async () => {
      const model = { providerID: 'anthropic', modelID: 'claude' }

      const omitted = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant: { model } }),
      })
      expect(omitted.status).toBe(200)
      expect(((await omitted.json()) as { variant: Record<string, string | undefined> }).variant).toEqual({
        'anthropic/claude': 'default',
      })

      const explicitNull = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant: { model, value: null } }),
      })
      expect(explicitNull.status).toBe(200)
      expect(((await explicitNull.json()) as { variant: Record<string, string | undefined> }).variant).toEqual({
        'anthropic/claude': 'default',
      })
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

  describe('model-state response contract', () => {
    let workDir: string

    beforeEach(async () => {
      workDir = await mkdtemp(path.join(tmpdir(), 'providers-model-state-'))
      modelStatePaths.file = path.join(workDir, 'model.json')
      const actual = modelStateMock.actual as typeof import('../services/opencode-model-state')
      modelStateMock.readOpenCodeModelState.mockImplementation(actual.readOpenCodeModelState)
      modelStateMock.updateOpenCodeModelState.mockImplementation(actual.updateOpenCodeModelState)
      await writeFile(
        modelStatePaths.file,
        JSON.stringify({ recent: [], favorite: [], variant: {}, extra: 1 }),
        'utf8',
      )
    })

    afterEach(async () => {
      await rm(workDir, { recursive: true, force: true })
    })

    it('GET omits unknown root keys', async () => {
      const res = await app.request('/providers/model-state')

      expect(res.status).toBe(200)
      const data = (await res.json()) as Record<string, unknown>
      expect(data).toEqual({ recent: [], favorite: [], variant: {} })
      expect(data).not.toHaveProperty('extra')
    })

    it('POST omits unknown root keys from the response but preserves them in the file', async () => {
      const res = await app.request('/providers/model-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recent: { providerID: 'anthropic', modelID: 'claude' } }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as Record<string, unknown>
      expect(data).toEqual({
        recent: [{ providerID: 'anthropic', modelID: 'claude' }],
        favorite: [],
        variant: {},
      })
      expect(data).not.toHaveProperty('extra')

      const file = JSON.parse(await readFile(modelStatePaths.file, 'utf8')) as { extra: unknown }
      expect(file.extra).toBe(1)
    })
  })

  describe('GET /credentials', () => {
    it('lists each provider from credentials once, without label or value', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.credential.list).mockResolvedValueOnce([
        credentialFixture('anthropic', 'cred_1'),
        credentialFixture('anthropic', 'cred_2'),
        credentialFixture('openai'),
      ])

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ providers: ['anthropic', 'openai'] })
    })

    it('omits a provider that only has an env connection and no credential', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockResolvedValueOnce({
        location: LOCATION,
        data: [
          integrationFixture({ id: 'anthropic', connections: [credentialConnection('cred_1')] }),
          integrationFixture({ id: 'openai', connections: [{ type: 'env', name: 'OPENAI_API_KEY' }] }),
        ],
      })
      vi.mocked(client.api.credential.list).mockResolvedValueOnce([credentialFixture('anthropic', 'cred_1')])

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ providers: ['anthropic'] })
    })

    it('includes a policy-filtered provider that still holds a credential', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockResolvedValueOnce({
        location: LOCATION,
        data: [integrationFixture({ id: 'openai' })],
      })
      vi.mocked(client.api.credential.list).mockResolvedValueOnce([credentialFixture('anthropic')])
      vi.mocked(client.api.integration.get).mockResolvedValueOnce({
        location: LOCATION,
        data: integrationFixture({ connections: [credentialConnection('cred_anthropic')] }),
      })
      const app = createCredentialApp(client)

      const listResponse = await app.request('/providers/credentials')
      expect(await listResponse.json()).toEqual({ providers: ['anthropic'] })

      const statusResponse = await app.request('/providers/anthropic/credentials/status')
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual({ hasCredentials: true })
    })

    it('includes a credential for an MCP-sourced integration', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockResolvedValueOnce({
        location: LOCATION,
        data: [integrationFixture({ id: 'mcp:sample', name: 'Sample MCP' })],
      })
      vi.mocked(client.api.credential.list).mockResolvedValueOnce([credentialFixture('mcp:sample')])

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ providers: ['mcp:sample'] })
    })

    it('maps a declared upstream error to 502 with the upstream message', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.credential.list).mockRejectedValueOnce(
        taggedError('UnknownError', 'upstream exploded'),
      )

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'upstream exploded' })
    })

    it('maps an unreachable upstream to 502', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.credential.list).mockRejectedValueOnce(new ClientError('UnexpectedStatus'))

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

    it('retries once after a loading integration becomes available', async () => {
      const client = createStubOpenCodeClient()
      const get = vi.mocked(client.api.integration.get)
      get.mockRejectedValueOnce(taggedError('IntegrationNotFoundError', 'Integration not found: anthropic'))
      get.mockResolvedValue({
        location: LOCATION,
        data: integrationFixture({ connections: [credentialConnection('cred_1')] }),
      })

      const res = await createCredentialApp(client).request('/providers/anthropic/credentials/status')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ hasCredentials: true })
      expect(get).toHaveBeenCalledTimes(3)
    })

    it('returns 404 for a missing integration', async () => {
      vi.useFakeTimers()
      try {
        const client = createStubOpenCodeClient()
        vi.mocked(client.api.integration.get).mockRejectedValue(
          taggedError('IntegrationNotFoundError', 'Integration not found: nope'),
        )

        const pending = createCredentialApp(client).request('/providers/nope/credentials/status')
        await vi.runAllTimersAsync()
        const res = await pending

        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({
          error: 'Integration not found: nope',
          code: 'IntegrationNotFoundError',
        })
      } finally {
        vi.useRealTimers()
      }
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

    it('retries once after a loading integration becomes available', async () => {
      const client = createStubOpenCodeClient()
      const get = vi.mocked(client.api.integration.get)
      get.mockRejectedValueOnce(taggedError('IntegrationNotFoundError', 'Integration not found: anthropic'))
      get.mockResolvedValue({
        location: LOCATION,
        data: integrationFixture({ connections: [credentialConnection('cred_1')] }),
      })

      const res = await createCredentialApp(client).request('/providers/anthropic/credentials', { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(vi.mocked(client.api.credential.remove)).toHaveBeenCalledWith({ credentialID: 'cred_1' })
      expect(get).toHaveBeenCalledTimes(3)
    })

    it('returns 404 for a missing integration', async () => {
      vi.useFakeTimers()
      try {
        const client = createStubOpenCodeClient()
        vi.mocked(client.api.integration.get).mockRejectedValue(
          taggedError('IntegrationNotFoundError', 'Integration not found: nope'),
        )

        const pending = createCredentialApp(client).request('/providers/nope/credentials', { method: 'DELETE' })
        await vi.runAllTimersAsync()
        const res = await pending

        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({
          error: 'Integration not found: nope',
          code: 'IntegrationNotFoundError',
        })
      } finally {
        vi.useRealTimers()
      }
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

describe.skipIf(!openCodeBinary)('providers credential inventory against a real OpenCode 2 server', () => {
  const VERSION = openCodeBinary ? readOpenCodeVersion(openCodeBinary) : null
  const HAS_CONNECT_POLICY = VERSION !== null && compareSemver(VERSION, '2.2.3') >= 0

  type Policy = { action: 'integration.connect' | 'integration.use'; resource: string; effect: 'deny' }

  function createApps(serve: OpenCodeServe) {
    const client = new FetchOpenCodeClient({
      baseUrl: serve.baseUrl,
      basicAuth: buildOpenCodeBasicAuth(serve.password),
    })
    const providers = new Hono()
    providers.route('/providers', createProvidersRoutes(client))
    const oauth = new Hono()
    oauth.route('/oauth', createOAuthRoutes(client))
    return { client, providers, oauth }
  }

  async function writePolicy(directories: OpenCodeServeDirectories, policies: Policy[]): Promise<void> {
    const configDirectory = path.join(directories.configHome, 'opencode')
    await mkdir(configDirectory, { recursive: true })
    await writeFile(path.join(configDirectory, 'opencode.json'), JSON.stringify({ policies }, null, 2))
  }

  async function restart(
    serve: OpenCodeServe,
    directories: OpenCodeServeDirectories,
    policies: Policy[],
  ): Promise<OpenCodeServe> {
    await serve.stop()
    await writePolicy(directories, policies)
    return startOpenCodeServe({ directories })
  }

  async function connectAnthropicKey(providers: Hono): Promise<void> {
    const response = await providers.request('/providers/anthropic/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-ant-binary-test' }),
    })
    expect(response.status).toBe(200)
  }

  async function credentialProviders(providers: Hono): Promise<string[]> {
    const response = await providers.request('/providers/credentials')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { providers: string[] }
    return body.providers
  }

  it('lists a stored credential in the inventory and the status route', async () => {
    const directories = await createOpenCodeServeDirectories()
    const serve = await startOpenCodeServe({ directories })
    try {
      const { client, providers } = createApps(serve)
      await client.api.integration.list()
      await connectAnthropicKey(providers)

      expect(await credentialProviders(providers)).toContain('anthropic')

      const status = await providers.request('/providers/anthropic/credentials/status')
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ hasCredentials: true })

      const credentials = await client.api.credential.list()
      expect(credentials.map((credential) => credential.integrationID)).toContain('anthropic')
    } finally {
      await serve.stop()
      await rm(directories.root, { recursive: true, force: true })
    }
  }, 120000)

  /** Requires OpenCode >= 2.2.3, the first release that parses integration.connect policies. */
  it.skipIf(!HAS_CONNECT_POLICY)('keeps a provider with a stored credential when integration.connect is denied', async () => {
    const directories = await createOpenCodeServeDirectories()
    let serve = await startOpenCodeServe({ directories })
    try {
      let apps = createApps(serve)
      await apps.client.api.integration.list()
      await connectAnthropicKey(apps.providers)

      serve = await restart(serve, directories, [
        { action: 'integration.connect', resource: 'anthropic', effect: 'deny' },
      ])
      apps = createApps(serve)

      const integrations = await apps.client.api.integration.list()
      expect(integrations.data.map((integration) => integration.id)).not.toContain('anthropic')

      const authMethods = await apps.oauth.request('/oauth/auth-methods')
      expect(authMethods.status).toBe(200)
      const authBody = (await authMethods.json()) as { providers: Record<string, unknown> }
      expect(authBody.providers).not.toHaveProperty('anthropic')

      const credentials = await apps.client.api.credential.list()
      expect(credentials.map((credential) => credential.integrationID)).toContain('anthropic')

      expect(await credentialProviders(apps.providers)).toContain('anthropic')

      const status = await apps.providers.request('/providers/anthropic/credentials/status')
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ hasCredentials: true })

      const rejected = await apps.providers.request('/providers/anthropic/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-ant-binary-test' }),
      })
      expect(rejected.status).toBe(502)
      const rejectedBody = (await rejected.json()) as { error: string }
      expect(rejectedBody.error).toContain('connecting anthropic is not allowed')
    } finally {
      await serve.stop()
      await rm(directories.root, { recursive: true, force: true })
    }
  }, 180000)

  it('keeps the provider listed when integration.use is denied', async () => {
    const directories = await createOpenCodeServeDirectories()
    await writePolicy(directories, [{ action: 'integration.use', resource: 'anthropic', effect: 'deny' }])
    const serve = await startOpenCodeServe({ directories })
    try {
      const { client, providers } = createApps(serve)
      await client.api.integration.list()
      await connectAnthropicKey(providers)

      const integrations = await client.api.integration.list()
      expect(integrations.data.map((integration) => integration.id)).toContain('anthropic')

      expect(await credentialProviders(providers)).toContain('anthropic')

      const status = await providers.request('/providers/anthropic/credentials/status')
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ hasCredentials: true })
    } finally {
      await serve.stop()
      await rm(directories.root, { recursive: true, force: true })
    }
  }, 120000)

  it('excludes an env-only provider from the inventory and reports no credential', async () => {
    const directories = await createOpenCodeServeDirectories()
    const serve = await startOpenCodeServe({ directories, env: { OPENAI_API_KEY: 'sk-openai-env-test' } })
    try {
      const { client, providers } = createApps(serve)
      await client.api.integration.list()

      expect(await credentialProviders(providers)).not.toContain('openai')

      const status = await providers.request('/providers/openai/credentials/status')
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ hasCredentials: false })

      const credentials = await client.api.credential.list()
      expect(credentials.map((credential) => credential.integrationID)).not.toContain('openai')
    } finally {
      await serve.stop()
      await rm(directories.root, { recursive: true, force: true })
    }
  }, 120000)

  it('names a provider once when it holds two credentials', async () => {
    const directories = await createOpenCodeServeDirectories()
    const serve = await startOpenCodeServe({ directories })
    try {
      const { client, providers } = createApps(serve)
      await client.api.integration.list()
      await connectAnthropicKey(providers)

      const second = await client.api.credential.create({
        integrationID: 'anthropic',
        value: { type: 'key', key: 'sk-ant-binary-second' },
      })
      await client.api.credential.activate({ credentialID: second.id })

      const listed = await credentialProviders(providers)
      expect(listed.filter((provider) => provider === 'anthropic')).toEqual(['anthropic'])

      const status = await providers.request('/providers/anthropic/credentials/status')
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ hasCredentials: true })
    } finally {
      await serve.stop()
      await rm(directories.root, { recursive: true, force: true })
    }
  }, 120000)
})
