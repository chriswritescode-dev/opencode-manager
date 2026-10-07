import {
  findModelInfo,
  parseOpenCodeModelRef,
  type ModelInfo,
  type ModelPreferenceModel,
} from '@opencode-manager/shared/opencode'

function toSelection(ref: string): ModelPreferenceModel | null {
  const parsed = parseOpenCodeModelRef(ref)
  return parsed ? { providerID: parsed.providerID, modelID: parsed.id } : null
}

export function isModelAvailable(
  models: ModelInfo[],
  ref: string | ModelPreferenceModel | null | undefined,
): boolean {
  if (!ref) return false
  const selection = typeof ref === 'string' ? toSelection(ref) : ref
  return selection !== null && findModelInfo(models, selection) !== undefined
}
