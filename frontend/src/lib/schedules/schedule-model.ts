import type { ModelInfo } from '@opencode-manager/shared/opencode'
import { isModelAvailable } from '@/lib/modelCatalog'

function normalizeModel(model: string | null | undefined): string | null {
  if (model === null || model === undefined) return null
  const trimmed = model.trim()
  return trimmed ? trimmed : null
}

export function resolveScheduleModel(
  storedModel: string | null | undefined,
  availableModels: ModelInfo[] | null,
): string | null {
  const stored = normalizeModel(storedModel)
  if (!stored) return null
  if (availableModels === null || availableModels.length === 0) return stored
  return isModelAvailable(availableModels, stored) ? stored : null
}
