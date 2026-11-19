import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@opencode-manager/shared/opencode'
import { createFetchFake, type FetchRoute } from '@/test/fetchFake'
import { makeCatalogModel, makeCatalogProvider, type CatalogProviderInfo } from '@/test/fixtures/api'
import {
  getOpenCodeConfiguredModel,
  getOpenCodeServerDefaultModel,
  getProviders,
  modelSelectionRef,
  providerCredentialsApi,
  providerModelRef,
  saveOpenCodeModelVariant,
} from './providers'

const providerRoute = '/api/opencode/api/provider'
const modelRoute = '/api/opencode/api/model'
const defaultModelRoute = '/api/opencode/api/model/default'
const configRoute = '/api/opencode/api/config'

function installRoutes(routes: FetchRoute[]): ReturnType<typeof createFetchFake> {
  const fetchFake = createFetchFake(routes)
  fetchFake.install()
  return fetchFake
}

function catalogRoutes(providers: CatalogProviderInfo[], models: ModelInfo[]): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: providerRoute,
      respond: () => ({ json: { location: { directory: '/repo' }, data: providers } }),
    },
    {
      method: 'GET',
      path: modelRoute,
      respond: () => ({ json: { location: { directory: '/repo' }, data: models } }),
    },
  ]
}

describe('getProviders', () => {
  it('maps V2 providers and models into the UI shape', async () => {
    installRoutes(
      catalogRoutes(
        [makeCatalogProvider()],
        [makeCatalogModel(), makeCatalogModel({
          id: 'claude-legacy',
          modelID: 'claude-legacy',
          name: 'Claude Legacy',
          status: 'deprecated',
        })],
      ),
    )

    const result = await getProviders('/repo')

    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]).toMatchObject({ id: 'anthropic', name: 'Anthropic' })
    expect(result.providers[0].models).toEqual([
      {
        id: 'claude-sonnet-4',
        modelID: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        limit: { context: 200000, output: 64000 },
        released: Date.UTC(2025, 4, 22),
        free: false,
      },
    ])
    expect(result.models).toHaveLength(2)
  })

  it('flags zero-cost models as free', async () => {
    installRoutes(
      catalogRoutes(
        [makeCatalogProvider({ id: 'opencode', name: 'OpenCode' })],
        [makeCatalogModel({ providerID: 'opencode', cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] })],
      ),
    )

    const result = await getProviders('/repo')

    expect(result.providers[0].models[0].free).toBe(true)
  })

  it('excludes disabled models and disabled providers from the picker', async () => {
    installRoutes(
      catalogRoutes(
        [makeCatalogProvider(), makeCatalogProvider({ id: 'disabled-provider', name: 'Disabled', activation: 'disabled' })],
        [
          makeCatalogModel(),
          makeCatalogModel({ id: 'claude-disabled', modelID: 'claude-disabled', enabled: false }),
          makeCatalogModel({ id: 'claude-off-provider', modelID: 'claude-off-provider', providerID: 'disabled-provider' }),
        ],
      ),
    )

    const result = await getProviders('/repo')

    expect(result.providers.map((provider) => provider.id)).toEqual(['anthropic'])
    expect(result.providers[0].models.map((model) => model.id)).toEqual(['claude-sonnet-4'])
  })

  it('sorts providers and models in the TUI order', async () => {
    installRoutes(
      catalogRoutes(
        [
          makeCatalogProvider({ id: 'zeta', name: 'Zeta' }),
          makeCatalogProvider({ id: 'opencode', name: 'OpenCode' }),
          makeCatalogProvider({ id: 'alpha', name: 'Alpha' }),
          makeCatalogProvider({ id: 'opencode-go', name: 'OpenCode Go' }),
        ],
        [
          makeCatalogModel({
            id: 'paid-new',
            modelID: 'paid-new',
            providerID: 'opencode',
            time: { released: 300 },
            cost: [{ input: 1, output: 1, cache: { read: 0, write: 0 } }],
          }),
          makeCatalogModel({
            id: 'free',
            modelID: 'free',
            providerID: 'opencode',
            time: { released: 100 },
            cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
          }),
          makeCatalogModel({
            id: 'paid-old',
            modelID: 'paid-old',
            providerID: 'opencode',
            time: { released: 200 },
            cost: [{ input: 1, output: 1, cache: { read: 0, write: 0 } }],
          }),
        ],
      ),
    )

    const result = await getProviders('/repo')

    expect(result.providers.map((provider) => provider.id)).toEqual(['opencode-go', 'opencode', 'alpha', 'zeta'])
    const opencode = result.providers.find((provider) => provider.id === 'opencode')
    expect(opencode?.models.map((model) => model.id)).toEqual(['free', 'paid-new', 'paid-old'])
  })

  it('requests the catalog for the directory', async () => {
    const fetchFake = installRoutes(catalogRoutes([makeCatalogProvider()], [makeCatalogModel()]))

    await getProviders('/repo')

    expect(fetchFake.lastRequest('GET', providerRoute)?.searchParams.get('location[directory]')).toBe('/repo')
    expect(fetchFake.lastRequest('GET', modelRoute)?.searchParams.get('location[directory]')).toBe('/repo')
  })

  it('degrades to an empty result when the upstream call fails', async () => {
    installRoutes([
      { method: 'GET', path: providerRoute, respond: () => ({ status: 500, json: { error: 'upstream down' } }) },
      { method: 'GET', path: modelRoute, respond: () => ({ json: { location: { directory: '/repo' }, data: [] } }) },
    ])

    await expect(getProviders('/repo')).resolves.toEqual({ providers: [], models: [] })
  })
})

describe('getOpenCodeConfiguredModel', () => {
  it.each([
    {
      title: 'keeps the variant of a string config model',
      entries: [{ type: 'document', info: { model: 'anthropic/claude-sonnet-4#thinking' } }],
      expected: 'anthropic/claude-sonnet-4#thinking',
    },
    {
      title: 'formats an object config model the same way',
      entries: [{ type: 'document', info: { model: { providerID: 'openai', model: 'gpt-4o', variant: 'high' } } }],
      expected: 'openai/gpt-4o#high',
    },
    {
      title: 'uses the last document that sets a model',
      entries: [
        { type: 'document', info: { model: 'anthropic/claude-sonnet-4' } },
        { type: 'document', info: { model: { providerID: 'openai', model: 'gpt-4o' } } },
        { type: 'document', info: {} },
      ],
      expected: 'openai/gpt-4o',
    },
    {
      title: 'returns null when no document sets a model',
      entries: [{ type: 'document', info: {} }],
      expected: null,
    },
  ])('$title', async ({ entries, expected }) => {
    installRoutes([{ method: 'GET', path: configRoute, respond: () => ({ json: entries }) }])

    await expect(getOpenCodeConfiguredModel('/repo')).resolves.toBe(expected)
  })

  it('returns null when the config read fails', async () => {
    installRoutes([{ method: 'GET', path: configRoute, respond: () => ({ status: 500, json: { error: 'upstream down' } }) }])

    await expect(getOpenCodeConfiguredModel('/repo')).resolves.toBeNull()
  })
})

describe('getOpenCodeServerDefaultModel', () => {
  const defaultModel = makeCatalogModel({ providerID: 'openai', id: 'gpt-5', modelID: 'gpt-5' })

  it('returns the server default as a model ref', async () => {
    installRoutes([
      {
        method: 'GET',
        path: defaultModelRoute,
        respond: () => ({ json: { location: { directory: '/repo' }, data: defaultModel } }),
      },
    ])

    await expect(getOpenCodeServerDefaultModel('/repo')).resolves.toEqual({ providerID: 'openai', id: 'gpt-5' })
  })

  it('returns null when the server reports no default model', async () => {
    installRoutes([
      {
        method: 'GET',
        path: defaultModelRoute,
        respond: () => ({ json: { location: { directory: '/repo' }, data: null } }),
      },
    ])

    await expect(getOpenCodeServerDefaultModel('/repo')).resolves.toBeNull()
  })

  it('returns null when the default model read fails', async () => {
    installRoutes([
      { method: 'GET', path: defaultModelRoute, respond: () => ({ status: 500, json: { error: 'upstream down' } }) },
    ])

    await expect(getOpenCodeServerDefaultModel('/repo')).resolves.toBeNull()
  })
})

describe('saveOpenCodeModelVariant', () => {
  it('posts the model and value and returns the state', async () => {
    const state = { recent: [], favorite: [], variant: { 'openai/gpt-5': 'high' } }
    const fetchFake = installRoutes([
      {
        method: 'POST',
        path: '/api/providers/model-state',
        respond: () => ({ json: state }),
      },
    ])

    await expect(saveOpenCodeModelVariant({ providerID: 'openai', modelID: 'gpt-5' }, 'high')).resolves.toEqual(state)
    expect(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body).toEqual({
      variant: { model: { providerID: 'openai', modelID: 'gpt-5' }, value: 'high' },
    })
  })

  it('sends null when the value is omitted', async () => {
    const fetchFake = installRoutes([
      {
        method: 'POST',
        path: '/api/providers/model-state',
        respond: () => ({ json: { recent: [], favorite: [], variant: {} } }),
      },
    ])

    await saveOpenCodeModelVariant({ providerID: 'openai', modelID: 'gpt-5' })

    expect(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body).toEqual({
      variant: { model: { providerID: 'openai', modelID: 'gpt-5' }, value: null },
    })
  })
})

describe('providerModelRef', () => {
  it('formats the provider and catalog model id as an OpenCode model ref', () => {
    expect(providerModelRef({ id: 'anthropic' }, { id: 'claude-sonnet-4' })).toBe('anthropic/claude-sonnet-4')
  })
})

describe('modelSelectionRef', () => {
  it('formats a selection as provider/model', () => {
    expect(modelSelectionRef({ providerID: 'openai', modelID: 'gpt-5' })).toBe('openai/gpt-5')
  })
})

describe('providerCredentialsApi', () => {
  it('reports credential status from the Manager response', async () => {
    const fetchFake = installRoutes([
      {
        method: 'GET',
        path: '/api/providers/anthropic/credentials/status',
        respond: () => ({ json: { hasCredentials: true } }),
      },
    ])

    await expect(providerCredentialsApi.getStatus('anthropic')).resolves.toBe(true)
    expect(fetchFake.findRequests('GET', '/api/providers/anthropic/credentials/status')).toHaveLength(1)
  })

  it.each([
    {
      title: 'posts the api key to the provider credential route',
      providerId: 'anthropic',
      answer: undefined,
      expectedBody: { apiKey: 'sk-ant-test' },
    },
    {
      title: 'posts the key method form answer alongside the api key',
      providerId: 'azure',
      answer: { resourceName: 'my-models' },
      expectedBody: { apiKey: 'sk-ant-test', answer: { resourceName: 'my-models' } },
    },
  ])('$title', async ({ providerId, answer, expectedBody }) => {
    const fetchFake = installRoutes([
      {
        method: 'POST',
        path: `/api/providers/${providerId}/credentials`,
        respond: () => ({ json: { success: true } }),
      },
    ])

    await providerCredentialsApi.set(providerId, 'sk-ant-test', answer)

    expect(fetchFake.lastRequest('POST', `/api/providers/${providerId}/credentials`)?.body).toMatchObject(expectedBody)
  })

  it('deletes credentials through the provider credential route', async () => {
    const fetchFake = installRoutes([
      {
        method: 'DELETE',
        path: '/api/providers/anthropic/credentials',
        respond: () => ({ json: { success: true } }),
      },
    ])

    await providerCredentialsApi.delete('anthropic')

    expect(fetchFake.findRequests('DELETE', '/api/providers/anthropic/credentials')).toHaveLength(1)
  })
})
