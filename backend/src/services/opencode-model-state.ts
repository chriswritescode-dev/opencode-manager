import { z } from 'zod'
import { getOpenCodeModelStatePath } from '@opencode-manager/shared/config/env'
import {
  decodeModelPreference,
  toModelPreference,
  type ModelPreference,
  type ModelPreferenceDocument,
} from '@opencode-manager/shared/opencode'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../utils/atomic-json'

export const ModelSelectionSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
})

export async function readOpenCodeModelState(): Promise<ModelPreference> {
  const raw = await readJsonSafe<unknown>(getOpenCodeModelStatePath(), null)
  return toModelPreference(decodeModelPreference(raw))
}

export async function updateOpenCodeModelState(
  mutate: (state: ModelPreferenceDocument) => ModelPreferenceDocument,
): Promise<ModelPreference> {
  const modelStatePath = getOpenCodeModelStatePath()

  return withFileLock(modelStatePath, async () => {
    const raw = await readJsonSafe<unknown>(modelStatePath, {})
    const decoded = decodeModelPreference(raw)
    const next = mutate(decoded)

    await writeJsonAtomic(modelStatePath, {
      ...decoded,
      recent: next.recent,
      favorite: next.favorite,
      variant: next.variant,
    })

    return toModelPreference(next)
  })
}
