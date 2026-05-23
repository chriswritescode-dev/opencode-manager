import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useModelStore } from '@/stores/modelStore'
import type { Provider } from '@/api/providers'

vi.mock('zustand/middleware', async () => {
  const actual = await vi.importActual('zustand/middleware')
  return {
    ...actual,
    persist: (config: any) => config,
  }
})

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: overrides.id ?? 'test-provider',
    name: overrides.name ?? 'Test Provider',
    models: overrides.models ?? {},
    env: [],
    isConnected: true,
    options: {},
    ...overrides,
  }
}

describe('validateAndSyncModel', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      recentModels: [],
      favoriteModels: [],
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('falls back to syncFromConfig when providers is undefined', () => {
    useModelStore.getState().validateAndSyncModel('anthropic/claude-sonnet-4', undefined)

    expect(useModelStore.getState().model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
  })

  it('sets active model from configModel when current model not in providers but configModel parses to valid model', () => {
    const providers = [
      makeProvider({
        id: 'openai',
        models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' } },
      }),
    ]

    useModelStore.setState({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
    })

    useModelStore.getState().validateAndSyncModel('openai/gpt-4o', providers)

    expect(useModelStore.getState().model).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
  })

  it('clears active model when invalid and no config fallback', () => {
    const providers = [
      makeProvider({
        id: 'openai',
        models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' } },
      }),
    ]

    useModelStore.setState({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
    })

    useModelStore.getState().validateAndSyncModel(undefined, providers)

    expect(useModelStore.getState().model).toBeNull()
  })

  it('prunes stale recents and favorites, keeps valid entries', () => {
    const providers = [
      makeProvider({
        id: 'anthropic',
        models: { 'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' } },
      }),
    ]

    useModelStore.setState({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      recentModels: [
        { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
        { providerID: 'openai', modelID: 'gpt-4o' },
      ],
      favoriteModels: [
        { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
        { providerID: 'openai', modelID: 'gpt-4o' },
      ],
    })

    useModelStore.getState().validateAndSyncModel('anthropic/claude-sonnet-4', providers)

    expect(useModelStore.getState().recentModels).toEqual([
      { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
    ])
    expect(useModelStore.getState().favoriteModels).toEqual([
      { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
    ])
  })

  it('is idempotent when re-running with same valid state', () => {
    const providers = [
      makeProvider({
        id: 'anthropic',
        models: { 'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' } },
      }),
    ]

    useModelStore.setState({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      recentModels: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
      favoriteModels: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
    })

    useModelStore.getState().validateAndSyncModel('anthropic/claude-sonnet-4', providers)

    const afterFirst = useModelStore.getState()

    let updateCount = 0
    const unsubscribe = useModelStore.subscribe(() => {
      updateCount++
    })

    useModelStore.getState().validateAndSyncModel('anthropic/claude-sonnet-4', providers)
    unsubscribe()

    const afterSecond = useModelStore.getState()

    expect(updateCount).toBe(0)
    expect(afterSecond.model).toEqual(afterFirst.model)
    expect(afterSecond.recentModels).toEqual(afterFirst.recentModels)
    expect(afterSecond.favoriteModels).toEqual(afterFirst.favoriteModels)
  })
})
