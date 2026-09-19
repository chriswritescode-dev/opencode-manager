import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getProvidersWithModels } from './providers'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'

const { mockGetOpenCodeConfig, mockFetchWrapper } = vi.hoisted(() => ({
  mockGetOpenCodeConfig: vi.fn(),
  mockFetchWrapper: vi.fn(),
}))

vi.mock('./settings', () => ({
  settingsApi: {
    getOpenCodeConfig: mockGetOpenCodeConfig,
  },
}))

vi.mock('./fetchWrapper', () => ({
  fetchWrapper: mockFetchWrapper,
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

describe('getProvidersWithModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchWrapper.mockResolvedValue({ all: [], connected: [], default: {} })
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
})
