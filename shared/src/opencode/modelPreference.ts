import type { ModelInfo, ModelRef } from '@opencode/client'
import { isRecord } from '../utils/record'

export type ModelPreferenceModel = {
  providerID: string
  modelID: string
}

export type ModelPreference = {
  recent: ModelPreferenceModel[]
  favorite: ModelPreferenceModel[]
  variant: Record<string, string | undefined>
}

export type ModelPreferenceDocument = Record<string, unknown> & ModelPreference

function models(value: unknown): ModelPreferenceModel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ModelPreferenceModel[] => {
    if (!isRecord(item)) return []
    if (typeof item.providerID !== 'string' || item.providerID.length === 0) return []
    if (typeof item.modelID !== 'string' || item.modelID.length === 0) return []
    return [{ providerID: item.providerID, modelID: item.modelID }]
  })
}

function variants(value: unknown): Record<string, string | undefined> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (key.length === 0 || typeof item !== 'string' || item.length === 0) return []
      return [[key, item]] as const
    }),
  )
}

export function normalizeModelVariant(value: string | undefined): string | undefined {
  return value === 'default' ? undefined : value
}

export function modelPreferenceKey(model: ModelPreferenceModel): string {
  return `${model.providerID}/${model.modelID}`
}

export function isSameModelSelection(a: ModelPreferenceModel, b: ModelPreferenceModel): boolean {
  return a.providerID === b.providerID && a.modelID === b.modelID
}

export function isSameModelRef(a: ModelRef | undefined | null, b: ModelRef | undefined | null): boolean {
  if (!a || !b) return !a && !b
  return (
    a.providerID === b.providerID &&
    a.id === b.id &&
    normalizeModelVariant(a.variant) === normalizeModelVariant(b.variant)
  )
}

export function findModelInfo(models: ModelInfo[], selection: ModelPreferenceModel): ModelInfo | undefined {
  return models.find((model) => model.providerID === selection.providerID && model.id === selection.modelID)
}

export function recentModels(model: ModelPreferenceModel, recent: ModelPreferenceModel[]): ModelPreferenceModel[] {
  const seen = new Set<string>()
  return [model, ...recent]
    .filter((item) => {
      const key = modelPreferenceKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

export function favoriteModels(
  model: ModelPreferenceModel,
  favorite: ModelPreferenceModel[],
  enabled: boolean,
): ModelPreferenceModel[] {
  const current = favorite.filter((item) => modelPreferenceKey(item) !== modelPreferenceKey(model))
  return enabled ? [model, ...current] : current
}

export function addRecentModel<T extends ModelPreference>(state: T, model: ModelPreferenceModel): T {
  return { ...state, recent: recentModels(model, state.recent) }
}

export function removeRecentModel<T extends ModelPreference>(state: T, model: ModelPreferenceModel): T {
  return { ...state, recent: state.recent.filter((item) => !isSameModelSelection(item, model)) }
}

export function toggleFavoriteModel<T extends ModelPreference>(state: T, model: ModelPreferenceModel): T {
  const exists = state.favorite.some((item) => isSameModelSelection(item, model))
  return { ...state, favorite: favoriteModels(model, state.favorite, !exists) }
}

export function setModelVariant<T extends ModelPreference>(
  state: T,
  model: ModelPreferenceModel,
  value: string | undefined,
): T {
  return {
    ...state,
    variant: { ...state.variant, [modelPreferenceKey(model)]: normalizeModelVariant(value) ?? 'default' },
  }
}

export function cycleModelVariant(current: string | undefined, variants: string[]): string | undefined {
  const named = variants.filter((variant) => variant !== 'default')
  if (named.length === 0) return undefined
  const value = normalizeModelVariant(current)
  if (value === undefined) return named[0]
  const index = named.indexOf(value)
  if (index === -1 || index === named.length - 1) return undefined
  return named[index + 1]
}

export function decodeModelPreference(value: unknown): ModelPreferenceDocument {
  const root = isRecord(value) ? value : {}
  return {
    ...root,
    recent: models(root.recent),
    favorite: models(root.favorite),
    variant: variants(root.variant),
  }
}

export function toModelPreference(doc: ModelPreference): ModelPreference {
  return { recent: doc.recent, favorite: doc.favorite, variant: doc.variant }
}

export function isModelFree(info: { cost: Array<{ input: number }> }): boolean {
  return info.cost.length > 0 && info.cost.every((cost) => cost.input === 0)
}

function refSelection(ref: ModelRef): ModelPreferenceModel {
  return { providerID: ref.providerID, modelID: ref.id }
}

interface SelectInteractiveModelOptions {
  models: ModelInfo[]
  current?: ModelPreferenceModel | null
  agentModel?: ModelRef | null
  configured?: ModelRef | null
  recent?: ModelPreferenceModel[]
}

export function selectInteractiveModel(options: SelectInteractiveModelOptions): ModelPreferenceModel | undefined {
  const candidates: Array<ModelPreferenceModel | undefined> = [
    options.current ?? undefined,
    options.agentModel ? refSelection(options.agentModel) : undefined,
    options.configured ? refSelection(options.configured) : undefined,
    ...(options.recent ?? []),
  ]

  const selected = candidates.find(
    (candidate): candidate is ModelPreferenceModel =>
      candidate !== undefined && findModelInfo(options.models, candidate) !== undefined,
  )
  if (selected) return selected

  const first = options.models[0]
  return first ? { providerID: first.providerID, modelID: first.id } : undefined
}

interface SelectPreferredVariantOptions {
  model: ModelPreferenceModel
  info?: ModelInfo | null
  preferences?: Record<string, string | undefined> | null
  agentModel?: ModelRef | null
  configured?: ModelRef | null
}

export function selectPreferredVariant(options: SelectPreferredVariantOptions): string | undefined {
  const { model, info, agentModel, configured } = options
  const preferences = options.preferences ?? {}
  const saved = preferences[modelPreferenceKey(model)]
  const agentVariant =
    agentModel && isSameModelSelection(model, refSelection(agentModel)) ? agentModel.variant : undefined
  const configuredVariant =
    configured && isSameModelSelection(model, refSelection(configured)) ? configured.variant : undefined

  const variant = normalizeModelVariant(saved ?? agentVariant ?? configuredVariant)
  return info?.variants.some((entry) => entry.id === variant) ? variant : undefined
}

interface CatalogSortEntry {
  providerID?: string
  providerName?: string
  name?: string
  cost?: Array<{ input: number }>
  time?: { released: number }
  free?: boolean
  released?: number
}

function providerRank(providerID: string | undefined): number {
  if (providerID === 'opencode-go') return 0
  if (providerID === 'opencode') return 1
  return 2
}

function catalogEntryFree(entry: CatalogSortEntry): boolean {
  if (entry.free !== undefined) return entry.free
  return entry.cost !== undefined && isModelFree({ cost: entry.cost })
}

function catalogEntryReleased(entry: CatalogSortEntry): number {
  return entry.released ?? entry.time?.released ?? 0
}

export function compareCatalogModels(a: CatalogSortEntry, b: CatalogSortEntry): number {
  const provider = providerRank(a.providerID) - providerRank(b.providerID)
  if (provider !== 0) return provider

  const providerName = (a.providerName ?? a.providerID ?? '').localeCompare(b.providerName ?? b.providerID ?? '')
  if (providerName !== 0) return providerName

  const free = Number(catalogEntryFree(b)) - Number(catalogEntryFree(a))
  if (free !== 0) return free

  const release = catalogEntryReleased(b) - catalogEntryReleased(a)
  if (release !== 0) return release

  return (a.name ?? '').localeCompare(b.name ?? '')
}

interface SelectEffectiveModelRefOptions {
  models: ModelInfo[]
  defaultModel?: ModelRef | null
  candidates?: Array<ModelRef | undefined | null>
}

export function selectEffectiveModelRef(options: SelectEffectiveModelRefOptions): ModelRef | undefined {
  const { models, defaultModel } = options

  for (const candidate of options.candidates ?? []) {
    if (candidate && findModelInfo(models, refSelection(candidate)) !== undefined) return candidate
  }

  if (defaultModel && findModelInfo(models, refSelection(defaultModel)) !== undefined) return defaultModel

  const fallback = models.find((model) => model.enabled)
  return fallback ? { providerID: fallback.providerID, id: fallback.id } : undefined
}
