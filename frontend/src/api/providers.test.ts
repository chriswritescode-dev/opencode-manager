import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getProviders, getProvidersWithModels, providerCredentialsApi } from './providers'
import { API_BASE_URL } from '@/config'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'

const { mockGetOpenCodeConfig, mockFetchWrapper, mockProviderList, mockModelList, mockModelDefault } = vi.hoisted(() => ({
  mockGetOpenCodeConfig: vi.fn(),
  mockFetchWrapper: vi.fn(),
  mockProviderList: vi.fn(),
  mockModelList: vi.fn(),
  mockModelDefault: vi.fn(),
}))

vi.mock('./settings', () => ({
  settingsApi: {
    getOpenCodeConfig: mockGetOpenCodeConfig,
  },
}))

vi.mock('./fetchWrapper', () => ({
  fetchWrapper: mockFetchWrapper,
}))

vi.mock('./opencodeApi', () => ({
  openCodeApi: {
    provider: { list: mockProviderList },
    model: { list: mockModelList, default: mockModelDefault },
  },
}))

const config = makeOpenCodeConfigFile({
  content: {
    provider: {
      openai: {
        name: 'OpenAI',
        models: {
          'gpt-4o': { name: 'GPT-4o' },
        },
      },
    },
  },
})

function makeAnthropicModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claude-sonnet-4',
    modelID: 'claude-sonnet-4-20250514',
    providerID: 'anthropic',
    name: 'Claude Sonnet 4',
    capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
    variants: [{ id: 'thinking', settings: { reasoning: 'high' } }],
    time: { released: Date.UTC(2025, 4, 22) },
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
    status: 'active',
    enabled: true,
    limit: { context: 200000, output: 64000 },
    ...overrides,
  }
}

describe('getProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderList.mockResolvedValue({ location: { directory: '/repo' }, data: [] })
    mockModelList.mockResolvedValue({ location: { directory: '/repo' }, data: [] })
    mockModelDefault.mockResolvedValue({ location: { directory: '/repo' }, data: null })
  })

  it('maps V2 providers, models, and the default into the UI shape', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { id: 'anthropic', name: 'Anthropic', activation: 'enabled', package: '@opencode/ai/providers/anthropic' },
      ],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        {
          id: 'claude-sonnet-4',
          modelID: 'claude-sonnet-4-20250514',
          providerID: 'anthropic',
          name: 'Claude Sonnet 4',
          capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
          variants: [{ id: 'thinking', settings: { reasoning: 'high' } }],
          time: { released: Date.UTC(2025, 4, 22) },
          cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
          status: 'active',
          enabled: true,
          limit: { context: 200000, output: 64000 },
        },
        {
          id: 'claude-legacy',
          modelID: 'claude-legacy',
          providerID: 'anthropic',
          name: 'Claude Legacy',
          capabilities: { tools: false, input: ['text'], output: ['text'] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: 'deprecated',
          enabled: true,
          limit: { context: 1, output: 1 },
        },
      ],
    })
    mockModelDefault.mockResolvedValue({
      location: { directory: '/repo' },
      data: {
        id: 'claude-sonnet-4',
        modelID: 'claude-sonnet-4-20250514',
        providerID: 'anthropic',
        name: 'Claude Sonnet 4',
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: 'active',
        enabled: true,
        limit: { context: 200000, output: 64000 },
      },
    })

    const result = await getProviders('/repo')

    expect(result.connected).toEqual(['anthropic'])
    expect(result.default).toEqual({ anthropic: 'claude-sonnet-4' })
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0].models['claude-sonnet-4']).toMatchObject({
      key: 'claude-sonnet-4',
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      attachment: true,
      tool_call: true,
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      limit: { context: 200000, output: 64000 },
      variants: { thinking: { reasoning: 'high' } },
    })
    expect(result.providers[0].models['claude-legacy']).toBeUndefined()
  })

  it('degrades to an empty result when the upstream call fails', async () => {
    mockProviderList.mockRejectedValue(new Error('upstream down'))

    await expect(getProviders('/repo')).resolves.toEqual({
      providers: [],
      connected: [],
      default: {},
    })
  })
})

describe('getProvidersWithModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchWrapper.mockResolvedValue({ all: [], connected: [], default: {} })
    mockProviderList.mockResolvedValue({ location: { directory: '/repo' }, data: [] })
    mockModelList.mockResolvedValue({ location: { directory: '/repo' }, data: [] })
    mockModelDefault.mockResolvedValue({ location: { directory: '/repo' }, data: null })
  })

  it('uses the supplied config instead of re-reading it', async () => {
    const providers = await getProvidersWithModels(undefined, config)

    expect(mockGetOpenCodeConfig).not.toHaveBeenCalled()
    expect(providers.map((provider) => provider.id)).toEqual(['openai'])
  })

  it('reads the config when none is supplied', async () => {
    mockGetOpenCodeConfig.mockResolvedValue(config)

    const providers = await getProvidersWithModels(undefined)

    expect(mockGetOpenCodeConfig).toHaveBeenCalledTimes(1)
    expect(providers.map((provider) => provider.id)).toEqual(['openai'])
  })

  it('degrades to no configured providers when the config read fails', async () => {
    mockGetOpenCodeConfig.mockRejectedValue(new Error('no config file'))

    const providers = await getProvidersWithModels(undefined)

    expect(providers).toEqual([])
  })

  it('merges configured providers from both provider and providers keys', async () => {
    const configWithProviders = makeOpenCodeConfigFile({
      content: {
        provider: {
          openai: { name: 'OpenAI', models: { 'gpt-4o': { name: 'GPT-4o' } } },
        },
        providers: {
          anthropic: { name: 'Anthropic', models: { 'claude-sonnet-4': { name: 'Claude Sonnet 4' } } },
        },
      },
    })

    const providers = await getProvidersWithModels(undefined, configWithProviders)

    expect(providers.map((provider) => provider.id).sort()).toEqual(['anthropic', 'openai'])
  })

  it('retains the resolved model catalog for a settings-only provider override', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [{ id: 'anthropic', name: 'Anthropic', activation: 'enabled' }],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        makeAnthropicModel(),
        makeAnthropicModel({
          id: 'claude-opus-4',
          modelID: 'claude-opus-4-20250514',
          name: 'Claude Opus 4',
        }),
      ],
    })
    const configWithSettings = makeOpenCodeConfigFile({
      content: { providers: { anthropic: { settings: { apiKey: 'test' } } } },
    })

    const providers = await getProvidersWithModels(undefined, configWithSettings)

    const anthropic = providers.find((provider) => provider.id === 'anthropic')
    expect(anthropic?.source).toBe('configured')
    expect(anthropic?.models.map((model) => model.key).sort()).toEqual(['claude-opus-4', 'claude-sonnet-4'])
  })

  it('retains every resolved model and its metadata when a partial model override exists', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [{ id: 'anthropic', name: 'Anthropic', activation: 'enabled' }],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        makeAnthropicModel(),
        makeAnthropicModel({
          id: 'claude-opus-4',
          modelID: 'claude-opus-4-20250514',
          name: 'Claude Opus 4',
        }),
      ],
    })
    const configWithOverride = makeOpenCodeConfigFile({
      content: { providers: { anthropic: { models: { 'claude-sonnet-4': { limit: { context: 1 } } } } } },
    })

    const providers = await getProvidersWithModels(undefined, configWithOverride)

    const anthropic = providers.find((provider) => provider.id === 'anthropic')
    expect(anthropic?.models.map((model) => model.key).sort()).toEqual(['claude-opus-4', 'claude-sonnet-4'])
    const sonnet = anthropic?.models.find((model) => model.key === 'claude-sonnet-4')
    expect(sonnet?.limit).toEqual({ context: 200000, output: 64000 })
    expect(sonnet?.cost).toEqual({ input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 })
    expect(sonnet?.variants).toEqual({ thinking: { reasoning: 'high' } })
  })

  it('appends config-only model entries that the resolved catalog omits', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [{ id: 'anthropic', name: 'Anthropic', activation: 'enabled' }],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [makeAnthropicModel()],
    })
    const configWithExtraModel = makeOpenCodeConfigFile({
      content: { providers: { anthropic: { models: { 'claude-custom': { name: 'Claude Custom' } } } } },
    })

    const providers = await getProvidersWithModels(undefined, configWithExtraModel)

    const anthropic = providers.find((provider) => provider.id === 'anthropic')
    expect(anthropic?.models.map((model) => model.key).sort()).toEqual(['claude-custom', 'claude-sonnet-4'])
    expect(anthropic?.models.find((model) => model.key === 'claude-custom')?.name).toBe('Claude Custom')
  })
})

describe('providerCredentialsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists provider ids with credentials from the Manager response', async () => {
    mockFetchWrapper.mockResolvedValue({ providers: ['anthropic', 'openai'] })

    await expect(providerCredentialsApi.list()).resolves.toEqual(['anthropic', 'openai'])
    expect(mockFetchWrapper).toHaveBeenCalledWith(`${API_BASE_URL}/api/providers/credentials`)
  })

  it('reports credential status from the Manager response', async () => {
    mockFetchWrapper.mockResolvedValue({ hasCredentials: true })

    await expect(providerCredentialsApi.getStatus('anthropic')).resolves.toBe(true)
    expect(mockFetchWrapper).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/providers/anthropic/credentials/status`
    )
  })

  it('posts the api key to the provider credential route', async () => {
    mockFetchWrapper.mockResolvedValue({ success: true })

    await providerCredentialsApi.set('anthropic', 'sk-ant-test')

    expect(mockFetchWrapper).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/providers/anthropic/credentials`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-ant-test' }),
      }
    )
  })

  it('posts the key method form answer alongside the api key', async () => {
    mockFetchWrapper.mockResolvedValue({ success: true })

    await providerCredentialsApi.set('azure', 'az-test', { resourceName: 'my-models' })

    expect(mockFetchWrapper).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/providers/azure/credentials`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'az-test', answer: { resourceName: 'my-models' } }),
      }
    )
  })

  it('deletes credentials through the provider credential route', async () => {
    mockFetchWrapper.mockResolvedValue({ success: true })

    await providerCredentialsApi.delete('anthropic')

    expect(mockFetchWrapper).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/providers/anthropic/credentials`,
      { method: 'DELETE' }
    )
  })
})
