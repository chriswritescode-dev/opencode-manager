import { z } from 'zod'
import {
  findModelInfo,
  parseOpenCodeModelRef,
  type ModelInfo,
  type ModelPreferenceModel,
} from '@opencode-manager/shared/opencode'

const ModelSelectionSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
})

function toSelection(ref: string): ModelPreferenceModel | null {
  const parsed = parseOpenCodeModelRef(ref)
  return parsed ? { providerID: parsed.providerID, modelID: parsed.id } : null
}

export function isModelAvailable(
  models: ModelInfo[],
  ref: string | ModelPreferenceModel | null | undefined,
): boolean {
  if (!ref) return false
  const selection = ModelSelectionSchema.safeParse(ref)
  if (selection.success) return findModelInfo(models, selection.data) !== undefined
  const refText = z.string().safeParse(ref)
  if (!refText.success) return false
  const fromText = toSelection(refText.data)
  return fromText !== null && findModelInfo(models, fromText) !== undefined
}
