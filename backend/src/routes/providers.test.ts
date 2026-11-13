import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { getOpenCodeModelStatePath } from '@opencode-manager/shared/config/env'
import { JsonObjectSchema } from '@opencode-manager/shared/utils'
import type { JsonObject, JsonValue } from '@opencode-manager/shared/utils'
import { createProvidersRoutes } from './providers'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { FetchOpenCodeClient } from '../services/opencode/client'
import { resolveOpenCode2Binary, startOpenCodeServe } from '../../test/helpers/opencode-binary'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { ClientError } from '@opencode-manager/shared/opencode'
import type { IntegrationInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../services/opencode/client'
import { createTempWorkspace, type TempWorkspace } from '../../test/helpers/test-env'
import { readJson } from '../../test/helpers/read-json'

const LOCATION = { directory: '/tmp/repo' }

const ModelSelectionBodySchema = z.object({ providerID: z.string(), modelID: z.string() })

const ModelPreferenceResponseSchema = z.object({
  recent: z.array(ModelSelectionBodySchema),
  favorite: z.array(ModelSelectionBodySchema),
  variant: z.record(z.string(), z.string().optional()),
})

const CredentialListResponseSchema = z.object({ providers: z.array(z.string()) })
const CredentialStatusResponseSchema = z.object({ hasCredentials: z.boolean() })
const SuccessResponseSchema = z.object({ success: z.boolean() })
const ErrorResponseSchema = z.object({ error: z.string(), code: z.string().optional() })

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

async function postModelState(app: Hono, body: JsonValue): Promise<Response> {
  return app.request('/providers/model-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('providers routes', () => {
  let app: Hono
  let workspace: TempWorkspace
  let modelStatePath: string

  beforeEach(() => {
    workspace = createTempWorkspace('providers-model-state-')
    modelStatePath = getOpenCodeModelStatePath()
    app = createTestApp()
  })

  afterEach(() => {
    workspace.restore()
  })

  describe('GET /model-state', () => {
    it('returns the empty state when no file has been written', async () => {
      const res = await app.request('/providers/model-state')

      expect(res.status).toBe(200)
      expect(await readJson(res, ModelPreferenceResponseSchema)).toEqual({
        recent: [],
        favorite: [],
        variant: {},
      })
    })
  })

  describe('POST /model-state', () => {
    it('with recent returns 200 with recent[0] set', async () => {
      const res = await postModelState(app, { recent: { providerID: 'anthropic', modelID: 'claude' } })

      expect(res.status).toBe(200)
      const data = await readJson(res, ModelPreferenceResponseSchema)
      expect(data.recent).toHaveLength(1)
      expect(data.recent[0]).toEqual({ providerID: 'anthropic', modelID: 'claude' })
    })

    it('with removeRecent removes the model', async () => {
      await postModelState(app, { recent: { providerID: 'openai', modelID: 'gpt-4' } })

      const res = await postModelState(app, { removeRecent: { providerID: 'openai', modelID: 'gpt-4' } })

      expect(res.status).toBe(200)
      expect((await readJson(res, ModelPreferenceResponseSchema)).recent).toHaveLength(0)
    })

    it('with favorite toggles favorite (add then remove)', async () => {
      const body = { favorite: { providerID: 'openai', modelID: 'gpt-4' } }

      const res1 = await postModelState(app, body)
      expect(res1.status).toBe(200)
      expect((await readJson(res1, ModelPreferenceResponseSchema)).favorite).toHaveLength(1)

      const res2 = await postModelState(app, body)
      expect(res2.status).toBe(200)
      expect((await readJson(res2, ModelPreferenceResponseSchema)).favorite).toHaveLength(0)
    })

    it('with variant persists the named variant', async () => {
      const res = await postModelState(app, {
        variant: { model: { providerID: 'anthropic', modelID: 'claude' }, value: 'high' },
      })

      expect(res.status).toBe(200)
      expect((await readJson(res, ModelPreferenceResponseSchema)).variant).toEqual({ 'anthropic/claude': 'high' })
    })

    const variantCases: Array<{ label: string; variant: JsonObject }> = [
      { label: 'omitted', variant: { model: { providerID: 'anthropic', modelID: 'claude' } } },
      { label: 'explicitly null', variant: { model: { providerID: 'anthropic', modelID: 'claude' }, value: null } },
    ]

    it.each(variantCases)('with variant value $label persists default', async ({ variant }) => {
      const res = await postModelState(app, { variant })

      expect(res.status).toBe(200)
      expect((await readJson(res, ModelPreferenceResponseSchema)).variant).toEqual({
        'anthropic/claude': 'default',
      })
    })

    it('with invalid body returns 400 and leaves the state untouched', async () => {
      const res = await postModelState(app, { invalid: 'data' })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorResponseSchema)).error).toBe('Invalid request data')
      const state = await app.request('/providers/model-state')
      expect(await readJson(state, ModelPreferenceResponseSchema)).toEqual({
        recent: [],
        favorite: [],
        variant: {},
      })
    })

    it('returns 500 when the state file cannot be written', async () => {
      await mkdir(modelStatePath, { recursive: true })

      const res = await postModelState(app, { recent: { providerID: 'test', modelID: 'test' } })

      expect(res.status).toBe(500)
      expect((await readJson(res, ErrorResponseSchema)).error).toBe('Failed to update OpenCode model state')
    })
  })

  describe('model-state response contract', () => {
    beforeEach(async () => {
      await mkdir(path.dirname(modelStatePath), { recursive: true })
      await writeFile(modelStatePath, JSON.stringify({ recent: [], favorite: [], variant: {}, extra: 1 }), 'utf8')
    })

    it('GET omits unknown root keys', async () => {
      const res = await app.request('/providers/model-state')

      expect(res.status).toBe(200)
      const data = await readJson(res, ModelPreferenceResponseSchema)
      expect(data).toEqual({ recent: [], favorite: [], variant: {} })
      expect(data).not.toHaveProperty('extra')
    })

    it('POST omits unknown root keys from the response but preserves them in the file', async () => {
      const res = await postModelState(app, { recent: { providerID: 'anthropic', modelID: 'claude' } })

      expect(res.status).toBe(200)
      const data = await readJson(res, ModelPreferenceResponseSchema)
      expect(data).toEqual({
        recent: [{ providerID: 'anthropic', modelID: 'claude' }],
        favorite: [],
        variant: {},
      })
      expect(data).not.toHaveProperty('extra')

      const file = JsonObjectSchema.parse(JSON.parse(await readFile(modelStatePath, 'utf8')))
      expect(file.extra).toBe(1)
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
      expect(await readJson(res, CredentialListResponseSchema)).toEqual({ providers: ['anthropic'] })
    })

    it('maps a declared upstream error to 502 with the upstream message', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockRejectedValueOnce(
        taggedError('UnknownError', 'upstream exploded'),
      )

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(502)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'upstream exploded' })
    })

    it('maps an unreachable upstream to 502', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.list).mockRejectedValueOnce(new ClientError('UnexpectedStatus'))

      const res = await createCredentialApp(client).request('/providers/credentials')

      expect(res.status).toBe(502)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({
        error: 'Failed to list provider credentials',
        code: 'ClientError',
      })
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
      expect(await readJson(res, CredentialStatusResponseSchema)).toEqual({ hasCredentials: true })
    })

    it('reports false when the integration only has env connections', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.integration.get).mockResolvedValueOnce({
        location: LOCATION,
        data: integrationFixture({ connections: [{ type: 'env', name: 'ANTHROPIC_API_KEY' }] }),
      })

      const res = await createCredentialApp(client).request('/providers/anthropic/credentials/status')

      expect(res.status).toBe(200)
      expect(await readJson(res, CredentialStatusResponseSchema)).toEqual({ hasCredentials: false })
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
        expect(await readJson(res, ErrorResponseSchema)).toEqual({
          error: 'Integration not found: nope',
          code: 'IntegrationNotFoundError',
        })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('POST /:id/credentials', () => {
    function connectRequest(app: Hono, providerId: string = 'anthropic', body: JsonValue = { apiKey: 'sk-test' }) {
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
      expect(await readJson(res, SuccessResponseSchema)).toEqual({ success: true })
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
      expect(await readJson(res, SuccessResponseSchema)).toEqual({ success: true })
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

    it('waits for plugin activation before connecting the key', async () => {
      const client = createStubOpenCodeClient()
      const providerList = vi.mocked(client.api.provider.list)
      const connectKey = vi.mocked(client.api.integration.connect.key)

      const res = await connectRequest(createCredentialApp(client))

      expect(res.status).toBe(200)
      expect(connectKey).toHaveBeenCalledTimes(1)
      expect(providerList).toHaveBeenCalledBefore(connectKey)
    })

    it('returns the plugin-activation failure without connecting the key', async () => {
      const client = createStubOpenCodeClient()
      vi.mocked(client.api.provider.list).mockRejectedValueOnce(
        taggedError('ServiceUnavailableError', 'Plugins are still loading'),
      )

      const res = await connectRequest(createCredentialApp(client))

      expect(res.status).toBe(502)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'Plugins are still loading' })
      expect(vi.mocked(client.api.integration.connect.key)).not.toHaveBeenCalled()
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
        expect(await readJson(res, ErrorResponseSchema)).toEqual({
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
      expect(await readJson(res, ErrorResponseSchema)).toEqual({
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
      expect(await readJson(res, SuccessResponseSchema)).toEqual({ success: true })
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
        expect(await readJson(res, ErrorResponseSchema)).toEqual({
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
      expect(await readJson(statusResponse, CredentialStatusResponseSchema)).toEqual({ hasCredentials: true })

      const listResponse = await app.request('/providers/credentials')
      expect(listResponse.status).toBe(200)
      const { providers } = await readJson(listResponse, CredentialListResponseSchema)
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

      const rejected = await app.request('/providers/azure/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'az-binary-test' }),
      })
      expect(rejected.status).toBe(502)
      expect(await readJson(rejected, ErrorResponseSchema)).toEqual({
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
      expect(await readJson(statusResponse, CredentialStatusResponseSchema)).toEqual({ hasCredentials: true })
    } finally {
      await serve.stop()
    }
  }, 120000)
})
