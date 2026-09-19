import { z } from 'zod'
import { getOpenCodeModelStatePath } from '@opencode-manager/shared/config/env'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../utils/atomic-json'
import { logger } from '../utils/logger'

export const ModelSelectionSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
})

export const ModelStateSchema = z.object({
  recent: z.array(ModelSelectionSchema).default([]),
  favorite: z.array(ModelSelectionSchema).default([]),
  variant: z.record(z.string(), z.string().optional()).default({}),
}).passthrough()

export interface ModelSelectionRecord {
  providerID: string
  modelID: string
}

export interface OpenCodeModelStateRecord {
  recent: ModelSelectionRecord[]
  favorite: ModelSelectionRecord[]
  variant: Record<string, string | undefined>
}

export const MAX_RECENT_MODELS = 10

function createEmptyState(): OpenCodeModelStateRecord {
  return { recent: [], favorite: [], variant: {} }
}

function toRecord(data: z.infer<typeof ModelStateSchema>): OpenCodeModelStateRecord {
  return { recent: data.recent, favorite: data.favorite, variant: data.variant }
}

export async function readOpenCodeModelState(): Promise<OpenCodeModelStateRecord> {
  const raw = await readJsonSafe<unknown>(getOpenCodeModelStatePath(), null)
  const parsed = ModelStateSchema.safeParse(raw)

  if (!parsed.success) {
    if (raw !== null) {
      logger.warn('OpenCode model state file has invalid structure', parsed.error)
    }
    return createEmptyState()
  }

  return toRecord(parsed.data)
}

export function addRecentModel(state: OpenCodeModelStateRecord, model: ModelSelectionRecord): OpenCodeModelStateRecord {
  const deduped = [
    model,
    ...state.recent.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID),
  ]
  return { ...state, recent: deduped.slice(0, MAX_RECENT_MODELS) }
}

export function removeRecentModel(state: OpenCodeModelStateRecord, model: ModelSelectionRecord): OpenCodeModelStateRecord {
  return {
    ...state,
    recent: state.recent.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID),
  }
}

export function toggleFavoriteModel(state: OpenCodeModelStateRecord, model: ModelSelectionRecord): OpenCodeModelStateRecord {
  const exists = state.favorite.some(
    m => m.providerID === model.providerID && m.modelID === model.modelID,
  )
  const favorite = exists
    ? state.favorite.filter(m => m.providerID !== model.providerID || m.modelID !== model.modelID)
    : [...state.favorite, model]

  return { ...state, favorite }
}

export async function updateOpenCodeModelState(
  mutate: (state: OpenCodeModelStateRecord) => OpenCodeModelStateRecord,
): Promise<OpenCodeModelStateRecord> {
  const modelStatePath = getOpenCodeModelStatePath()

  return withFileLock(modelStatePath, async () => {
    const raw = await readJsonSafe<unknown>(modelStatePath, {})
    const parsed = ModelStateSchema.safeParse(raw)
    const current = parsed.success ? toRecord(parsed.data) : createEmptyState()
    const next = mutate(current)
    const rawObject = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}

    await writeJsonAtomic(modelStatePath, {
      ...rawObject,
      recent: next.recent,
      favorite: next.favorite,
      variant: next.variant,
    })

    return next
  })
}
