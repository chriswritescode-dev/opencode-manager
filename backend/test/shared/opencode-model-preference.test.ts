import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@opencode-manager/shared/opencode'
import {
  addRecentModel,
  compareCatalogModels,
  cycleModelVariant,
  decodeModelPreference,
  favoriteModels,
  findModelInfo,
  isModelFree,
  isSameModelRef,
  isSameModelSelection,
  modelPreferenceKey,
  normalizeModelVariant,
  recentModels,
  removeRecentModel,
  selectEffectiveModelRef,
  selectInteractiveModel,
  selectPreferredVariant,
  setModelVariant,
  toModelPreference,
  toggleFavoriteModel,
  type ModelPreference,
} from '@opencode-manager/shared/opencode'

interface ModelInfoInput {
  providerID: string
  id: string
  name?: string
  enabled?: boolean
  status?: ModelInfo['status']
  variants?: string[]
  released?: number
  cost?: Array<{ input: number }>
}

function modelInfo(input: ModelInfoInput): ModelInfo {
  return {
    providerID: input.providerID,
    id: input.id,
    name: input.name ?? input.id,
    enabled: input.enabled ?? true,
    status: input.status ?? 'active',
    variants: (input.variants ?? []).map((id) => ({ id })),
    time: { released: input.released ?? 0 },
    cost: (input.cost ?? []).map((cost) => ({
      input: cost.input,
      output: cost.input,
      cache: { read: 0, write: 0 },
    })),
  } as ModelInfo
}

describe('OpenCode model preference helpers', () => {
  describe('normalizeModelVariant', () => {
    it('maps the explicit default variant to undefined', () => {
      expect(normalizeModelVariant('default')).toBeUndefined()
    })

    it('passes named variants through', () => {
      expect(normalizeModelVariant('high')).toBe('high')
      expect(normalizeModelVariant(undefined)).toBeUndefined()
    })
  })

  describe('modelPreferenceKey', () => {
    it('joins the provider and model id', () => {
      expect(modelPreferenceKey({ providerID: 'p', modelID: 'm' })).toBe('p/m')
    })
  })

  describe('recentModels', () => {
    it('prepends the model and removes duplicates', () => {
      const recent = [
        { providerID: 'a', modelID: 'one' },
        { providerID: 'b', modelID: 'two' },
        { providerID: 'a', modelID: 'one' },
      ]

      expect(recentModels({ providerID: 'a', modelID: 'one' }, recent)).toEqual([
        { providerID: 'a', modelID: 'one' },
        { providerID: 'b', modelID: 'two' },
      ])
    })

    it('caps the list at ten entries', () => {
      const recent = Array.from({ length: 15 }, (_, index) => ({
        providerID: 'p',
        modelID: `m${index}`,
      }))

      const result = recentModels({ providerID: 'fresh', modelID: 'new' }, recent)

      expect(result).toHaveLength(10)
      expect(result[0]).toEqual({ providerID: 'fresh', modelID: 'new' })
      expect(result[9]).toEqual({ providerID: 'p', modelID: 'm8' })
    })
  })

  describe('favoriteModels', () => {
    it('prepends a new favorite and removes duplicates', () => {
      const favorite = [
        { providerID: 'a', modelID: 'one' },
        { providerID: 'b', modelID: 'two' },
        { providerID: 'a', modelID: 'one' },
      ]

      expect(favoriteModels({ providerID: 'a', modelID: 'one' }, favorite, true)).toEqual([
        { providerID: 'a', modelID: 'one' },
        { providerID: 'b', modelID: 'two' },
      ])
    })

    it('removes the model when disabled', () => {
      const favorite = [
        { providerID: 'a', modelID: 'one' },
        { providerID: 'b', modelID: 'two' },
      ]

      expect(favoriteModels({ providerID: 'a', modelID: 'one' }, favorite, false)).toEqual([
        { providerID: 'b', modelID: 'two' },
      ])
    })
  })

  describe('cycleModelVariant', () => {
    it('skips the default variant and starts at the first named variant', () => {
      expect(cycleModelVariant(undefined, ['default', 'low', 'high'])).toBe('low')
    })

    it('advances through named variants and wraps back to none', () => {
      expect(cycleModelVariant('low', ['default', 'low', 'high'])).toBe('high')
      expect(cycleModelVariant('high', ['default', 'low', 'high'])).toBeUndefined()
    })

    it('returns undefined when there are no named variants', () => {
      expect(cycleModelVariant('low', ['default'])).toBeUndefined()
      expect(cycleModelVariant(undefined, [])).toBeUndefined()
    })
  })

  describe('decodeModelPreference', () => {
    it('drops malformed entries, keeps unknown root keys and a literal default variant', () => {
      const decoded = decodeModelPreference({
        recent: [
          { providerID: 'a', modelID: 'b' },
          { providerID: '', modelID: 'x' },
          { providerID: 'c' },
          'not-an-object',
        ],
        favorite: [{ providerID: 'f', modelID: 'm' }],
        variant: { 'a/b': 'default', 'c/d': 'high', x: '', '': 'y', z: 5 },
        extra: 1,
      })

      expect(decoded.recent).toEqual([{ providerID: 'a', modelID: 'b' }])
      expect(decoded.favorite).toEqual([{ providerID: 'f', modelID: 'm' }])
      expect(decoded.variant).toEqual({ 'a/b': 'default', 'c/d': 'high' })
      expect(decoded.extra).toBe(1)
    })

    it('returns an empty preference for a non-record value', () => {
      expect(decodeModelPreference(null)).toEqual({ recent: [], favorite: [], variant: {} })
    })
  })

  describe('isModelFree', () => {
    it('is free when every cost tier has a zero input price', () => {
      expect(isModelFree(modelInfo({ providerID: 'p', id: 'm', cost: [{ input: 0 }] }))).toBe(true)
    })

    it('is not free when any cost tier charges, or when there are no tiers', () => {
      expect(isModelFree(modelInfo({ providerID: 'p', id: 'm', cost: [{ input: 0 }, { input: 3 }] }))).toBe(false)
      expect(isModelFree(modelInfo({ providerID: 'p', id: 'm' }))).toBe(false)
    })
  })
})

describe('selectInteractiveModel', () => {
  const models = [
    modelInfo({ providerID: 'openai', id: 'gpt-5' }),
    modelInfo({ providerID: 'anthropic', id: 'claude-sonnet-4' }),
    modelInfo({ providerID: 'opencode', id: 'big-pickle' }),
  ]

  it('prefers the current pick when it is valid', () => {
    expect(
      selectInteractiveModel({
        models,
        current: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
        agentModel: { providerID: 'openai', id: 'gpt-5' },
      }),
    ).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
  })

  it('falls through the agent model, configured model and first valid recent', () => {
    expect(
      selectInteractiveModel({
        models,
        current: { providerID: 'missing', modelID: 'none' },
        agentModel: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      }),
    ).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })

    expect(
      selectInteractiveModel({
        models,
        agentModel: { providerID: 'missing', id: 'none' },
        configured: { providerID: 'openai', id: 'gpt-5' },
      }),
    ).toEqual({ providerID: 'openai', modelID: 'gpt-5' })

    expect(
      selectInteractiveModel({
        models,
        configured: { providerID: 'missing', id: 'none' },
        recent: [
          { providerID: 'missing', modelID: 'none' },
          { providerID: 'opencode', modelID: 'big-pickle' },
        ],
      }),
    ).toEqual({ providerID: 'opencode', modelID: 'big-pickle' })
  })

  it('falls back to the first catalog model when nothing else is valid', () => {
    expect(selectInteractiveModel({ models })).toEqual({ providerID: 'openai', modelID: 'gpt-5' })
  })

  it('returns undefined with no catalog models', () => {
    expect(selectInteractiveModel({ models: [] })).toBeUndefined()
  })
})

describe('selectPreferredVariant', () => {
  const model = { providerID: 'openai', modelID: 'gpt-5' }
  const info = modelInfo({ providerID: 'openai', id: 'gpt-5', variants: ['low', 'high'] })

  it('lets a saved preference win', () => {
    expect(
      selectPreferredVariant({
        model,
        info,
        preferences: { 'openai/gpt-5': 'high' },
        agentModel: { providerID: 'openai', id: 'gpt-5', variant: 'low' },
      }),
    ).toBe('high')
  })

  it('lets a saved default beat the agent variant and produce none', () => {
    expect(
      selectPreferredVariant({
        model,
        info,
        preferences: { 'openai/gpt-5': 'default' },
        agentModel: { providerID: 'openai', id: 'gpt-5', variant: 'high' },
      }),
    ).toBeUndefined()
  })

  it('uses the agent variant when the agent model matches', () => {
    expect(
      selectPreferredVariant({
        model,
        info,
        preferences: {},
        agentModel: { providerID: 'openai', id: 'gpt-5', variant: 'low' },
      }),
    ).toBe('low')
  })

  it('uses the configured variant when the configured model matches', () => {
    expect(
      selectPreferredVariant({
        model,
        info,
        preferences: {},
        agentModel: { providerID: 'openai', id: 'other', variant: 'low' },
        configured: { providerID: 'openai', id: 'gpt-5', variant: 'high' },
      }),
    ).toBe('high')
  })

  it('drops a variant the model does not declare', () => {
    expect(
      selectPreferredVariant({
        model,
        info,
        preferences: { 'openai/gpt-5': 'medium' },
      }),
    ).toBeUndefined()
  })
})

describe('compareCatalogModels', () => {
  it('orders opencode-go, then opencode, then other providers', () => {
    const anthropic = modelInfo({ providerID: 'anthropic', id: 'claude', name: 'Claude' })
    const opencode = modelInfo({ providerID: 'opencode', id: 'big-pickle', name: 'Big Pickle' })
    const go = modelInfo({ providerID: 'opencode-go', id: 'gpt-oss', name: 'Gpt Oss' })

    const sorted = [anthropic, opencode, go].sort(compareCatalogModels)

    expect(sorted.map((entry) => entry.providerID)).toEqual(['opencode-go', 'opencode', 'anthropic'])
  })

  it('orders remaining providers by provider name', () => {
    const zeta = modelInfo({ providerID: 'zeta', id: 'z', name: 'Z' })
    const alpha = modelInfo({ providerID: 'alpha', id: 'a', name: 'A' })

    expect([zeta, alpha].sort(compareCatalogModels).map((entry) => entry.providerID)).toEqual(['alpha', 'zeta'])
  })

  it('prefers a provider display name over the provider id when both are present', () => {
    const byIdFirst = { providerID: 'alpha', providerName: 'Zeta', name: 'Model' }
    const byNameFirst = { providerID: 'zeta', providerName: 'Alpha', name: 'Model' }

    expect([byIdFirst, byNameFirst].sort(compareCatalogModels).map((entry) => entry.providerID)).toEqual([
      'zeta',
      'alpha',
    ])
  })

  it('orders free models first, then newest, then by name within a provider', () => {
    const paidNew = modelInfo({ providerID: 'anthropic', id: 'paid-new', name: 'Paid New', released: 20, cost: [{ input: 3 }] })
    const paidOld = modelInfo({ providerID: 'anthropic', id: 'paid-old', name: 'Paid Old', released: 10, cost: [{ input: 3 }] })
    const free = modelInfo({ providerID: 'anthropic', id: 'free', name: 'Free', released: 1, cost: [{ input: 0 }] })
    const paidTieA = modelInfo({ providerID: 'anthropic', id: 'a', name: 'Alpha', released: 5, cost: [{ input: 3 }] })
    const paidTieB = modelInfo({ providerID: 'anthropic', id: 'b', name: 'Beta', released: 5, cost: [{ input: 3 }] })

    const sorted = [paidNew, paidOld, free, paidTieB, paidTieA].sort(compareCatalogModels)

    expect(sorted.map((entry) => entry.id)).toEqual(['free', 'paid-new', 'paid-old', 'a', 'b'])
  })
})

describe('selectEffectiveModelRef', () => {
  const models = [
    modelInfo({ providerID: 'openai', id: 'gpt-5' }),
    modelInfo({ providerID: 'openai', id: 'gpt-5-mini' }),
  ]

  it('returns the first available candidate with its variant', () => {
    expect(
      selectEffectiveModelRef({
        models,
        defaultModel: { providerID: 'openai', id: 'gpt-5-mini' },
        candidates: [
          { providerID: 'openai', id: 'missing' },
          { providerID: 'openai', id: 'gpt-5', variant: 'high' },
        ],
      }),
    ).toEqual({ providerID: 'openai', id: 'gpt-5', variant: 'high' })
  })

  it('falls back to the default model when no candidate is available', () => {
    expect(
      selectEffectiveModelRef({
        models,
        defaultModel: { providerID: 'openai', id: 'gpt-5-mini' },
        candidates: [{ providerID: 'openai', id: 'missing' }],
      }),
    ).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
  })

  it('falls back to the first enabled model when the default is unavailable', () => {
    expect(
      selectEffectiveModelRef({
        models: [modelInfo({ providerID: 'openai', id: 'gpt-5', enabled: false }), models[1]!],
        defaultModel: { providerID: 'openai', id: 'retired' },
      }),
    ).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
  })

  it('returns undefined when nothing is available', () => {
    expect(selectEffectiveModelRef({ models: [modelInfo({ providerID: 'openai', id: 'gpt-5', enabled: false })] })).toBeUndefined()
    expect(selectEffectiveModelRef({ models: [] })).toBeUndefined()
  })
})

describe('isSameModelSelection', () => {
  it('matches the provider and model id', () => {
    expect(isSameModelSelection({ providerID: 'openai', modelID: 'gpt-5' }, { providerID: 'openai', modelID: 'gpt-5' })).toBe(true)
  })

  it('rejects a different provider or model id', () => {
    expect(isSameModelSelection({ providerID: 'openai', modelID: 'gpt-5' }, { providerID: 'anthropic', modelID: 'gpt-5' })).toBe(false)
    expect(isSameModelSelection({ providerID: 'openai', modelID: 'gpt-5' }, { providerID: 'openai', modelID: 'gpt-5-mini' })).toBe(false)
  })
})

describe('isSameModelRef', () => {
  it('treats two missing references as equal and one missing as different', () => {
    expect(isSameModelRef(undefined, undefined)).toBe(true)
    expect(isSameModelRef(null, null)).toBe(true)
    expect(isSameModelRef(undefined, null)).toBe(true)
    expect(isSameModelRef({ providerID: 'openai', id: 'gpt-5' }, undefined)).toBe(false)
    expect(isSameModelRef(undefined, { providerID: 'openai', id: 'gpt-5' })).toBe(false)
  })

  it('matches the provider, id and variant', () => {
    expect(isSameModelRef({ providerID: 'openai', id: 'gpt-5', variant: 'high' }, { providerID: 'openai', id: 'gpt-5', variant: 'high' })).toBe(true)
    expect(isSameModelRef({ providerID: 'openai', id: 'gpt-5', variant: 'high' }, { providerID: 'openai', id: 'gpt-5' })).toBe(false)
    expect(isSameModelRef({ providerID: 'openai', id: 'gpt-5' }, { providerID: 'anthropic', id: 'gpt-5' })).toBe(false)
    expect(isSameModelRef({ providerID: 'openai', id: 'gpt-5' }, { providerID: 'openai', id: 'gpt-5-mini' })).toBe(false)
  })

  it('treats the explicit default variant as no variant', () => {
    expect(isSameModelRef({ providerID: 'openai', id: 'gpt-5', variant: 'default' }, { providerID: 'openai', id: 'gpt-5' })).toBe(true)
    expect(isSameModelRef({ providerID: 'openai', id: 'gpt-5', variant: 'default' }, { providerID: 'openai', id: 'gpt-5', variant: undefined })).toBe(true)
  })
})

describe('findModelInfo', () => {
  const entry = { ...modelInfo({ providerID: 'openai', id: 'gpt-5' }), modelID: 'gpt-5-backing' } as ModelInfo

  it('matches the OpenCode key, not the backing model id', () => {
    expect(findModelInfo([entry], { providerID: 'openai', modelID: 'gpt-5' })).toBe(entry)
    expect(findModelInfo([entry], { providerID: 'openai', modelID: 'gpt-5-backing' })).toBeUndefined()
  })

  it('requires the provider to match too', () => {
    expect(findModelInfo([entry], { providerID: 'anthropic', modelID: 'gpt-5' })).toBeUndefined()
  })
})

describe('model preference updaters', () => {
  const emptyState = (): ModelPreference => ({ recent: [], favorite: [], variant: {} })

  it('addRecentModel prepends, deduplicates and preserves other keys', () => {
    const model = { providerID: 'openai', modelID: 'gpt-5' }
    const withExtra = { ...emptyState(), extra: 1 }
    const added = addRecentModel(withExtra, model)
    const reAdded = addRecentModel(addRecentModel(added, { providerID: 'anthropic', modelID: 'claude' }), model)

    expect(reAdded.recent).toEqual([model, { providerID: 'anthropic', modelID: 'claude' }])
    expect(reAdded.extra).toBe(1)
  })

  it('removeRecentModel filters by selection', () => {
    const state: ModelPreference = {
      recent: [
        { providerID: 'anthropic', modelID: 'claude' },
        { providerID: 'openai', modelID: 'gpt-4o' },
      ],
      favorite: [],
      variant: {},
    }

    expect(removeRecentModel(state, { providerID: 'anthropic', modelID: 'claude' }).recent).toEqual([
      { providerID: 'openai', modelID: 'gpt-4o' },
    ])
  })

  it('toggleFavoriteModel adds then removes', () => {
    const model = { providerID: 'anthropic', modelID: 'claude' }
    const added = toggleFavoriteModel(emptyState(), model)

    expect(added.favorite).toEqual([model])
    expect(toggleFavoriteModel(added, model).favorite).toEqual([])
  })

  it('setModelVariant stores default for missing values and merges the map', () => {
    const state: ModelPreference = { recent: [], favorite: [], variant: { 'a/b': 'low' } }

    expect(setModelVariant(state, { providerID: 'c', modelID: 'd' }, undefined).variant).toEqual({
      'a/b': 'low',
      'c/d': 'default',
    })
    expect(setModelVariant(state, { providerID: 'a', modelID: 'b' }, 'default').variant).toEqual({ 'a/b': 'default' })
    expect(setModelVariant(state, { providerID: 'a', modelID: 'b' }, 'high').variant).toEqual({ 'a/b': 'high' })
  })
})

describe('toModelPreference', () => {
  it('returns only the recent, favorite and variant keys', () => {
    const doc = {
      recent: [{ providerID: 'anthropic', modelID: 'claude' }],
      favorite: [{ providerID: 'openai', modelID: 'gpt-4' }],
      variant: { 'anthropic/claude': 'high' },
      extra: 1,
      session: { current: 'abc' },
    }

    const preference = toModelPreference(doc)

    expect(preference).toEqual({
      recent: [{ providerID: 'anthropic', modelID: 'claude' }],
      favorite: [{ providerID: 'openai', modelID: 'gpt-4' }],
      variant: { 'anthropic/claude': 'high' },
    })
    expect(preference).not.toHaveProperty('extra')
    expect(preference).not.toHaveProperty('session')
  })
})
