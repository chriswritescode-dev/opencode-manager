import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getOpenCodeConfiguredModel,
  getOpenCodeServerDefaultModel,
  getProviders,
  modelSelectionRef,
  providerCredentialsApi,
  providerModelRef,
  saveOpenCodeModelVariant,
} from './providers'
import { API_BASE_URL } from '@/config'

const { mockFetchWrapper, mockProviderList, mockModelList, mockModelDefault, mockConfigGet } = vi.hoisted(() => ({
  mockFetchWrapper: vi.fn(),
  mockProviderList: vi.fn(),
  mockModelList: vi.fn(),
  mockModelDefault: vi.fn(),
  mockConfigGet: vi.fn(),
}))

vi.mock('./fetchWrapper', () => ({
  fetchWrapper: mockFetchWrapper,
}))

vi.mock('./opencodeApi', () => ({
  callOpenCode: (operation: (api: unknown) => Promise<unknown>) =>
    operation({
      provider: { list: mockProviderList },
      model: { list: mockModelList, default: mockModelDefault },
      config: { get: mockConfigGet },
    }),
}))

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
  })

  it('maps V2 providers and models into the UI shape', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { id: 'anthropic', name: 'Anthropic', activation: 'enabled', package: '@opencode/ai/providers/anthropic' },
      ],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        makeAnthropicModel(),
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
    const result = await getProviders('/repo')

    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]).toMatchObject({ id: 'anthropic', name: 'Anthropic' })
    expect(result.providers[0].models).toHaveLength(1)
    expect(result.providers[0].models[0]).toMatchObject({
      key: 'claude-sonnet-4',
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      limit: { context: 200000, output: 64000 },
      released: Date.UTC(2025, 4, 22),
      free: false,
    })
    expect(result.models).toHaveLength(2)
  })

  it('flags zero-cost models as free', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [{ id: 'opencode', name: 'OpenCode', activation: 'enabled' }],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [makeAnthropicModel({ providerID: 'opencode', cost: [{ input: 0, output: 0 }] })],
    })

    const result = await getProviders('/repo')

    expect(result.providers[0].models[0].free).toBe(true)
  })

  it('excludes disabled models and disabled providers from the picker', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { id: 'anthropic', name: 'Anthropic', activation: 'enabled' },
        { id: 'disabled-provider', name: 'Disabled', activation: 'disabled' },
      ],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        makeAnthropicModel(),
        makeAnthropicModel({ id: 'claude-disabled', modelID: 'claude-disabled', enabled: false }),
        makeAnthropicModel({ id: 'claude-off-provider', modelID: 'claude-off-provider', providerID: 'disabled-provider' }),
      ],
    })

    const result = await getProviders('/repo')

    expect(result.providers.map((provider) => provider.id)).toEqual(['anthropic'])
    expect(result.providers[0].models.map((model) => model.key)).toEqual(['claude-sonnet-4'])
  })

  it('sorts providers and models in the TUI order', async () => {
    mockProviderList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { id: 'zeta', name: 'Zeta', activation: 'enabled' },
        { id: 'opencode', name: 'OpenCode', activation: 'enabled' },
        { id: 'alpha', name: 'Alpha', activation: 'enabled' },
        { id: 'opencode-go', name: 'OpenCode Go', activation: 'enabled' },
      ],
    })
    mockModelList.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        makeAnthropicModel({ id: 'paid-new', modelID: 'paid-new', providerID: 'opencode', time: { released: 300 }, cost: [{ input: 1, output: 1 }] }),
        makeAnthropicModel({ id: 'free', modelID: 'free', providerID: 'opencode', time: { released: 100 }, cost: [{ input: 0, output: 0 }] }),
        makeAnthropicModel({ id: 'paid-old', modelID: 'paid-old', providerID: 'opencode', time: { released: 200 }, cost: [{ input: 1, output: 1 }] }),
      ],
    })

    const result = await getProviders('/repo')

    expect(result.providers.map((provider) => provider.id)).toEqual([
      'opencode-go',
      'opencode',
      'alpha',
      'zeta',
    ])
    const opencode = result.providers.find((provider) => provider.id === 'opencode')
    expect(opencode?.models.map((model) => model.id)).toEqual(['free', 'paid-new', 'paid-old'])
  })

  it('degrades to an empty result when the upstream call fails', async () => {
    mockProviderList.mockRejectedValue(new Error('upstream down'))

    await expect(getProviders('/repo')).resolves.toEqual({
      providers: [],
      models: [],
    })
  })
})

describe('getOpenCodeConfiguredModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the variant of a string config model', async () => {
    mockConfigGet.mockResolvedValue([{ type: 'document', info: { model: 'anthropic/claude-sonnet-4#thinking' } }])

    await expect(getOpenCodeConfiguredModel('/repo')).resolves.toBe('anthropic/claude-sonnet-4#thinking')
    expect(mockConfigGet).toHaveBeenCalledWith({ location: { directory: '/repo' } })
  })

  it('formats an object config model the same way', async () => {
    mockConfigGet.mockResolvedValue([
      { type: 'document', info: { model: { providerID: 'openai', model: 'gpt-4o', variant: 'high' } } },
    ])

    await expect(getOpenCodeConfiguredModel()).resolves.toBe('openai/gpt-4o#high')
    expect(mockConfigGet).toHaveBeenCalledWith(undefined)
  })

  it('uses the last document that sets a model', async () => {
    mockConfigGet.mockResolvedValue([
      { type: 'document', info: { model: 'anthropic/claude-sonnet-4' } },
      { type: 'document', info: { model: { providerID: 'openai', model: 'gpt-4o' } } },
      { type: 'document', info: {} },
    ])

    await expect(getOpenCodeConfiguredModel('/repo')).resolves.toBe('openai/gpt-4o')
  })

  it('returns null when no document sets a model', async () => {
    mockConfigGet.mockResolvedValue([{ type: 'document', info: {} }])

    await expect(getOpenCodeConfiguredModel('/repo')).resolves.toBeNull()
  })

  it('returns null when the config read fails', async () => {
    mockConfigGet.mockRejectedValue(new Error('upstream down'))

    await expect(getOpenCodeConfiguredModel('/repo')).resolves.toBeNull()
  })
})

describe('getOpenCodeServerDefaultModel', () => {
  const location = { location: { directory: '/repo' } }

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelDefault.mockResolvedValue({
      location: { directory: '/repo' },
      data: makeAnthropicModel({ providerID: 'openai', id: 'gpt-5', modelID: 'gpt-5' }),
    })
  })

  it('returns the server default as a model ref', async () => {
    await expect(getOpenCodeServerDefaultModel('/repo')).resolves.toEqual({
      providerID: 'openai',
      id: 'gpt-5',
    })
  })

  it('returns null when the server reports no default model', async () => {
    mockModelDefault.mockResolvedValue({ location: { directory: '/repo' }, data: null })

    await expect(getOpenCodeServerDefaultModel('/repo')).resolves.toBeNull()
  })

  it('passes the location to the default model call', async () => {
    await getOpenCodeServerDefaultModel('/repo')

    expect(mockModelDefault).toHaveBeenCalledWith(location)
  })

  it('returns null when the default model read fails', async () => {
    mockModelDefault.mockRejectedValue(new Error('upstream down'))

    await expect(getOpenCodeServerDefaultModel('/repo')).resolves.toBeNull()
  })
})

describe('saveOpenCodeModelVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts the model and value and returns the state', async () => {
    const state = { recent: [], favorite: [], variant: { 'openai/gpt-5': 'high' } }
    mockFetchWrapper.mockResolvedValue(state)

    await expect(saveOpenCodeModelVariant({ providerID: 'openai', modelID: 'gpt-5' }, 'high')).resolves.toEqual(state)
    expect(mockFetchWrapper).toHaveBeenCalledWith(`${API_BASE_URL}/api/providers/model-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: { model: { providerID: 'openai', modelID: 'gpt-5' }, value: 'high' } }),
    })
  })

  it('sends null when the value is omitted', async () => {
    mockFetchWrapper.mockResolvedValue({ recent: [], favorite: [], variant: {} })

    await saveOpenCodeModelVariant({ providerID: 'openai', modelID: 'gpt-5' })

    expect(mockFetchWrapper).toHaveBeenCalledWith(`${API_BASE_URL}/api/providers/model-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: { model: { providerID: 'openai', modelID: 'gpt-5' }, value: null } }),
    })
  })
})

describe('providerModelRef', () => {
  it('prefers the catalog key over the backing model id', () => {
    expect(providerModelRef({ id: 'anthropic' }, { id: 'claude-sonnet-4-20250514', key: 'claude-sonnet-4' })).toBe(
      'anthropic/claude-sonnet-4'
    )
  })

  it('falls back to the model id when no key is present', () => {
    expect(providerModelRef({ id: 'openai' }, { id: 'gpt-4o' })).toBe('openai/gpt-4o')
  })
})

describe('modelSelectionRef', () => {
  it('formats a selection as provider/model', () => {
    expect(modelSelectionRef({ providerID: 'openai', modelID: 'gpt-5' })).toBe('openai/gpt-5')
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
