import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useModelStore, modelExists, modelStorePartialize, modelStoreMigrate } from '@/stores/modelStore'
import type { Provider } from '@/api/providers'

beforeEach(() => {
  useModelStore.persist.clearStorage()
  useModelStore.setState({
    model: null,
    agentModels: {},
    variants: {},
    lastConfigModel: undefined,
  })
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

  it('invalidates stale hydrated model when current model not in providers and no config fallback', () => {
    const providers = [
      makeProvider({
        id: 'openrouter',
        models: { 'qwen/qwen3-235b-a22b': { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B' } },
      }),
    ]

    useModelStore.setState({
      model: { providerID: 'openrouter', modelID: 'qwen/qwen3-35b' },
    })

    useModelStore.getState().validateAndSyncModel(undefined, providers)

    expect(useModelStore.getState().model).toBeNull()
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
  })
})

describe('setModel', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('sets the model', () => {
    const model = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    useModelStore.getState().setModel(model)
    expect(useModelStore.getState().model).toEqual(model)
  })

  it('replaces the previous model', () => {
    useModelStore.setState({ model: { providerID: 'openai', modelID: 'gpt-4o' } })
    useModelStore.getState().setModel({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    expect(useModelStore.getState().model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
  })
})

describe('setActiveModel', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('sets the active model', () => {
    const model = { providerID: 'anthropic', modelID: 'claude-sonnet-4' }
    useModelStore.getState().setActiveModel(model)
    expect(useModelStore.getState().model).toEqual(model)
  })
})

describe('agentModels', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('setAgentModel stores model for agent', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    useModelStore.getState().setAgentModel('agent-1', model)
    expect(useModelStore.getState().agentModels['agent-1']).toEqual(model)
  })

  it('getAgentModel returns model for agent', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    useModelStore.getState().setAgentModel('agent-1', model)
    expect(useModelStore.getState().getAgentModel('agent-1')).toEqual(model)
  })

  it('getAgentModel returns null for unknown agent', () => {
    expect(useModelStore.getState().getAgentModel('unknown')).toBeNull()
  })

  it('setAgentModel replaces existing model for same agent', () => {
    useModelStore.getState().setAgentModel('agent-1', { providerID: 'openai', modelID: 'gpt-4o' })
    useModelStore.getState().setAgentModel('agent-1', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    expect(useModelStore.getState().agentModels['agent-1']).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
  })
})

describe('syncFromConfig', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('sets model and lastConfigModel from valid config string', () => {
    useModelStore.getState().syncFromConfig('anthropic/claude-sonnet-4')
    expect(useModelStore.getState().model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    expect(useModelStore.getState().lastConfigModel).toBe('anthropic/claude-sonnet-4')
  })

  it('does nothing when same config already synced', () => {
    useModelStore.setState({ model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' }, lastConfigModel: 'anthropic/claude-sonnet-4' })
    useModelStore.getState().syncFromConfig('anthropic/claude-sonnet-4')

    expect(useModelStore.getState().lastConfigModel).toBe('anthropic/claude-sonnet-4')
  })

  it('updates when force is true even if same config', () => {
    useModelStore.setState({ model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' }, lastConfigModel: 'anthropic/claude-sonnet-4' })
    useModelStore.getState().syncFromConfig('anthropic/claude-sonnet-4', true)

    expect(useModelStore.getState().lastConfigModel).toBe('anthropic/claude-sonnet-4')
  })

  it('handles invalid config string gracefully', () => {
    useModelStore.getState().syncFromConfig('invalid')
    expect(useModelStore.getState().model).toBeNull()
    expect(useModelStore.getState().lastConfigModel).toBe('invalid')
  })

  it('handles undefined config string', () => {
    useModelStore.getState().syncFromConfig(undefined)
    expect(useModelStore.getState().lastConfigModel).toBeUndefined()
  })
})

describe('getModelString', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('returns null when no model selected', () => {
    expect(useModelStore.getState().getModelString()).toBeNull()
  })

  it('returns providerID/modelID string when model is set', () => {
    useModelStore.setState({ model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' } })
    expect(useModelStore.getState().getModelString()).toBe('anthropic/claude-sonnet-4')
  })
})

describe('variants', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('setVariant stores variant for model', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    useModelStore.getState().setVariant(model, 'gpt-4o-2024-05-13')
    expect(useModelStore.getState().variants['openai/gpt-4o']).toBe('gpt-4o-2024-05-13')
  })

  it('getVariant returns variant for model', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    useModelStore.getState().setVariant(model, 'gpt-4o-2024-05-13')
    expect(useModelStore.getState().getVariant(model)).toBe('gpt-4o-2024-05-13')
  })

  it('getVariant returns undefined when no variant set', () => {
    expect(useModelStore.getState().getVariant({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })).toBeUndefined()
  })

  it('clearVariant removes variant for model', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    useModelStore.getState().setVariant(model, 'gpt-4o-2024-05-13')
    useModelStore.getState().clearVariant(model)
    expect(useModelStore.getState().variants['openai/gpt-4o']).toBeUndefined()
  })

  it('clearVariant is idempotent', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    expect(() => useModelStore.getState().clearVariant(model)).not.toThrow()
  })

  it('clearVariant does not notify subscribers when variant is already absent', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    const listener = vi.fn()
    const unsubscribe = useModelStore.subscribe(listener)

    useModelStore.getState().clearVariant(model)

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })

  it('setVariant does not notify subscribers when variant is unchanged', () => {
    const model = { providerID: 'openai', modelID: 'gpt-4o' }
    useModelStore.getState().setVariant(model, 'gpt-4o-2024-05-13')
    const listener = vi.fn()
    const unsubscribe = useModelStore.subscribe(listener)

    useModelStore.getState().setVariant(model, 'gpt-4o-2024-05-13')

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('syncModelState', () => {
  beforeEach(() => {
    useModelStore.setState({
      model: null,
      agentModels: {},
      variants: {},
      lastConfigModel: undefined,
    })
  })

  it('merges variants from model state', () => {
    useModelStore.getState().syncModelState({
      recent: [],
      favorite: [],
      variant: { 'anthropic/claude-sonnet-4': 'claude-sonnet-4-20250514' },
    })

    expect(useModelStore.getState().variants['anthropic/claude-sonnet-4']).toBe('claude-sonnet-4-20250514')
  })

  it('existing store variants take precedence over incoming variants', () => {
    useModelStore.setState({ variants: { 'anthropic/claude-sonnet-4': 'existing-variant' } })

    useModelStore.getState().syncModelState({
      recent: [],
      favorite: [],
      variant: { 'anthropic/claude-sonnet-4': 'incoming-variant' },
    })

    expect(useModelStore.getState().variants['anthropic/claude-sonnet-4']).toBe('existing-variant')
  })

  it('ignores recent and favorite fields from model state', () => {
    useModelStore.getState().syncModelState({
      recent: [{ providerID: 'openai', modelID: 'gpt-4o' }],
      favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4' }],
      variant: {},
    })

    const state = useModelStore.getState() as Record<string, unknown>
    expect(state).not.toHaveProperty('recentModels')
    expect(state).not.toHaveProperty('favoriteModels')
  })
})

describe('modelExists', () => {
  const providers = [
    makeProvider({
      id: 'openai',
      models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' } },
    }),
    makeProvider({
      id: 'anthropic',
      models: { 'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' } },
    }),
  ]

  it('returns true when provider and model exist', () => {
    expect(modelExists({ providerID: 'openai', modelID: 'gpt-4o' }, providers)).toBe(true)
  })

  it('returns false when provider does not exist', () => {
    expect(modelExists({ providerID: 'nonexistent', modelID: 'gpt-4o' }, providers)).toBe(false)
  })

  it('returns false when model does not exist in provider', () => {
    expect(modelExists({ providerID: 'openai', modelID: 'nonexistent' }, providers)).toBe(false)
  })

  it('returns false when model is null', () => {
    expect(modelExists(null, providers)).toBe(false)
  })

  it('returns false when providers list is empty', () => {
    expect(modelExists({ providerID: 'openai', modelID: 'gpt-4o' }, [])).toBe(false)
  })
})

describe('modelStorePartialize', () => {
  it('returns only model and agentModels', () => {
    const result = modelStorePartialize({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      agentModels: { 'agent-1': { providerID: 'openai', modelID: 'gpt-4o' } },
      variants: { 'anthropic/claude-sonnet-4': 'some-variant' },
      lastConfigModel: 'anthropic/claude-sonnet-4',
    } as Parameters<typeof modelStorePartialize>[0])

    expect(result).toEqual({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      agentModels: { 'agent-1': { providerID: 'openai', modelID: 'gpt-4o' } },
    })
    expect(result).not.toHaveProperty('variants')
    expect(result).not.toHaveProperty('lastConfigModel')
  })
})

describe('modelStoreMigrate', () => {
  it('strips legacy recentModels, favoriteModels, and variants keys from flat state (Zustand v5 call shape)', () => {
    const legacy = {
      model: { providerID: 'p', modelID: 'm' },
      agentModels: {},
      recentModels: [{ providerID: 'old', modelID: 'old' }],
      favoriteModels: [{ providerID: 'old', modelID: 'old' }],
      variants: { 'old/old': 'v1' },
    }

    const migrated = modelStoreMigrate(legacy)

    expect(migrated).toEqual({
      model: { providerID: 'p', modelID: 'm' },
      agentModels: {},
    })
  })

  it('preserves model and agentModels during migration of flat state', () => {
    const legacy = {
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      agentModels: { 'agent-1': { providerID: 'openai', modelID: 'gpt-4o' } },
      recentModels: [{ providerID: 'openai', modelID: 'gpt-4o' }],
      favoriteModels: [],
      variants: {},
    }

    const migrated = modelStoreMigrate(legacy)

    expect(migrated).toEqual({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      agentModels: { 'agent-1': { providerID: 'openai', modelID: 'gpt-4o' } },
    })
  })

  it('handles null/undefined input gracefully', () => {
    expect(modelStoreMigrate(null)).toBeNull()
    expect(modelStoreMigrate(undefined)).toBeUndefined()
  })

  it('also strips legacy keys from nested Zustand state envelope', () => {
    const legacy = {
      state: {
        model: { providerID: 'p', modelID: 'm' },
        agentModels: {},
        recentModels: [{ providerID: 'old', modelID: 'old' }],
        favoriteModels: [{ providerID: 'old', modelID: 'old' }],
        variants: { 'old/old': 'v1' },
      },
      version: 0,
    }

    const migrated = modelStoreMigrate(legacy)

    expect(migrated).toEqual({
      state: {
        model: { providerID: 'p', modelID: 'm' },
        agentModels: {},
      },
      version: 0,
    })
  })

  it('returns non-object input unchanged', () => {
    expect(modelStoreMigrate('string')).toBe('string')
    expect(modelStoreMigrate(42)).toBe(42)
  })

  it('handles state without legacy keys (new users)', () => {
    const clean = {
      model: { providerID: 'p', modelID: 'm' },
      agentModels: {},
    }

    const migrated = modelStoreMigrate(clean)

    expect(migrated).toEqual(clean)
  })

  it('migrate function is wired through persist.getOptions()', () => {
    const legacy = {
      model: { providerID: 'p', modelID: 'm' },
      agentModels: {},
      recentModels: [{ providerID: 'old', modelID: 'old' }],
      favoriteModels: [{ providerID: 'old', modelID: 'old' }],
      variants: { 'old/old': 'v1' },
    }

    const options = useModelStore.persist.getOptions()
    const migrated = options.migrate?.(legacy, 0)

    expect(migrated).toEqual({
      model: { providerID: 'p', modelID: 'm' },
      agentModels: {},
    })
  })
})
