import { describe, expect, it } from 'vitest'
import type { ConfigEntry, ModelInfo, PluginInfo, ProviderInfo } from '@opencode/client'
import { applyMiniMaxCatalogPolicy } from '../../../shared/src/opencode/minimaxCatalog'
import { isSelectableCatalogModel, selectEffectiveModelRef, selectInteractiveModel, selectPreferredVariant } from '../../../shared/src/opencode/modelPreference'

function model(id: string, providerID = 'minimax'): ModelInfo {
  return {
    id, modelID: id, providerID, name: id, enabled: true, status: 'active',
    capabilities: { input: ['text', 'image'], output: ['text'], tools: true },
    variants: [{ id: 'high', settings: { reasoning_effort: 'high' } }],
    time: { released: 0 }, limit: { context: 1000000, output: 524288 }, cost: [],
  } as ModelInfo
}

const providers = ['minimax', 'minimax-cn', 'opencode', 'openrouter'].map((id) => ({ id })) as ProviderInfo[]
const raw = [model('MiniMax-M2.7'), model('MiniMax-M3'), model('MiniMax-M3.1-Flash')]
const policy = (entries: ConfigEntry[] = [], plugins: PluginInfo[] = []) => applyMiniMaxCatalogPolicy(raw, providers, entries, plugins)

describe('MiniMax ordinary catalog', () => {
  it('chooses Flash in both fallbacks and keeps the complete runtime catalog', () => {
    const models = policy()
    expect(models).toHaveLength(3)
    expect(models.filter(isSelectableCatalogModel).map((item) => item.id)).toEqual(['MiniMax-M3', 'MiniMax-M3.1-Flash'])
    expect(selectInteractiveModel({ models })).toEqual({ providerID: 'minimax', modelID: 'MiniMax-M3.1-Flash' })
    expect(selectEffectiveModelRef({ models })).toEqual({ providerID: 'minimax', id: 'MiniMax-M3.1-Flash' })
    expect(selectEffectiveModelRef({ models, defaultModel: raw[0] })).toEqual({ providerID: 'minimax', id: 'MiniMax-M3.1-Flash' })
  })

  it('preserves current, configured, recent, explicit and variant selections', () => {
    const models = policy()
    const ref = { providerID: 'minimax', id: 'MiniMax-M2.7', variant: 'high' }
    const selection = { providerID: ref.providerID, modelID: ref.id }
    for (const options of [{ current: selection }, { configured: ref }, { agentModel: ref }, { recent: [selection] }]) {
      expect(selectInteractiveModel({ models, ...options })).toEqual(selection)
    }
    expect(selectEffectiveModelRef({ models, candidates: [ref] })).toBe(ref)
    expect(selectEffectiveModelRef({ models, defaultModel: ref })).toBe(ref)
    expect(selectPreferredVariant({ model: selection, info: models[0], configured: ref })).toBe('high')
  })

  it('preserves native same-ID config and unknown plugins including failed plugins', () => {
    expect(policy([{ type: 'document', info: { providers: { minimax: { models: { 'MiniMax-M2.7': {} } } } } }])).toEqual(raw)
    expect(policy([{ type: 'document', info: { plugins: ['custom-plugin'] } }])).toEqual(raw)
    for (const source of [{ type: 'sdk' }, { type: 'package', target: 'custom' }, { type: 'local', path: '/custom.js' }] as PluginInfo['source'][]) {
      expect(policy([], [{ source, features: {}, state: { status: 'active' } }])).toEqual(raw)
      expect(policy([], [{ source, features: {}, state: { status: 'failed', error: 'partial setup' } }])).toEqual(raw)
    }
  })

  it('exempts only verified manager IDs and exact local paths', () => {
    const plugin: PluginInfo = { id: 'ocm.manager', source: { type: 'local', path: '/managed/ocm-manager.js' }, features: {}, state: { status: 'active' } }
    const verified = [{ id: 'ocm.manager', path: '/managed/ocm-manager.js' }]
    expect(applyMiniMaxCatalogPolicy(raw, providers, [], [plugin], verified)[0].miniMaxCatalogRank).toBe(-1)
    expect(policy([], [plugin])).toEqual(raw)
    expect(applyMiniMaxCatalogPolicy(raw, providers, [], [{ ...plugin, id: 'custom' }], verified)).toEqual(raw)
    expect(applyMiniMaxCatalogPolicy(raw, providers, [], [{ ...plugin, source: { type: 'local', path: '/other/ocm-manager.js' } }], verified)).toEqual(raw)
  })

  it('uses exact regional and gateway IDs without inventing catalog entries or metadata', () => {
    for (const [providerID, legacy, m3, flash] of [
      ['minimax-cn', 'MiniMax-M2.7', 'MiniMax-M3', 'MiniMax-M3.1-Flash'],
      ['opencode', 'minimax-m2.7-free', 'minimax-m3', 'minimax-m3.1-flash-free'],
      ['openrouter', 'minimax/minimax-m2.7', 'minimax/minimax-m3', 'minimax/minimax-m3.1-flash:free'],
    ]) {
      const models = applyMiniMaxCatalogPolicy([model(legacy, providerID), model(m3, providerID), model(flash, providerID)], providers, [], [])
      expect(selectInteractiveModel({ models })?.modelID).toBe(flash)
      expect(selectInteractiveModel({ models: models.slice(0, 2) })?.modelID).toBe(m3)
      expect(models[2].limit).toEqual(raw[2].limit)
      expect(models[2].cost).toEqual([])
    }
  })

  it('preserves non-MiniMax, media, custom aliases and non-MiniMax default order', () => {
    const other = model('gpt-test', 'openai')
    const media = { ...model('MiniMax-Media'), capabilities: { input: ['text'], output: ['audio'], tools: false } } as ModelInfo
    const alias = { ...raw[0], id: 'custom-model' }
    const mismatched = { ...raw[0], canonical: 'custom' }
    const models = applyMiniMaxCatalogPolicy([other, media, alias, mismatched, ...raw], providers, [], [])
    expect(models.slice(0, 4)).toEqual([other, media, alias, mismatched])
    expect(selectInteractiveModel({ models })?.modelID).toBe(other.id)
  })
})
