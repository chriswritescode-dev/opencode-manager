import type { ProviderWithModels } from '@/api/providers'
import type { OpenCodeConfigFile } from '@/api/types/settings'

function normalizeModel(model: unknown): string | null {
  if (typeof model !== 'string') return null
  const trimmed = model.trim()
  return trimmed ? trimmed : null
}

export function buildAvailableModelKeys(providers: ProviderWithModels[]): Set<string> {
  const keys = new Set<string>()
  for (const provider of providers) {
    for (const model of provider.models) {
      keys.add(`${provider.id}/${model.key ?? model.id}`)
      keys.add(`${provider.id}/${model.id}`)
    }
  }
  return keys
}

export function getConfigDefaultModel(configFile: OpenCodeConfigFile | undefined): string | null {
  return normalizeModel(configFile?.content?.model)
}

export function resolveScheduleModel(
  storedModel: string | null | undefined,
  availableModelKeys: ReadonlySet<string> | null,
  configDefaultModel: string | null | undefined,
): string | null {
  const stored = normalizeModel(storedModel)
  if (!stored) return null
  if (availableModelKeys === null) return stored
  if (availableModelKeys.has(stored)) return stored
  const configDefault = normalizeModel(configDefaultModel)
  if (configDefault && availableModelKeys.has(configDefault)) return configDefault
  return null
}
