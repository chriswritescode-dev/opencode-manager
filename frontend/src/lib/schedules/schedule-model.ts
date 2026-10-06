import type { OpenCodeModelState, ProviderWithModels } from '@/api/providers'
import { providerModelRef } from '@/api/providers'
import type { ComboboxOption } from '@/components/ui/combobox'
import { buildModelSections } from '@/lib/modelSections'

function normalizeModel(model: unknown): string | null {
  if (typeof model !== 'string') return null
  const trimmed = model.trim()
  return trimmed ? trimmed : null
}

export function buildAvailableModelKeys(providers: ProviderWithModels[]): Set<string> {
  const keys = new Set<string>()
  for (const provider of providers) {
    for (const model of provider.models) {
      keys.add(providerModelRef(provider, model))
      keys.add(`${provider.id}/${model.id}`)
    }
  }
  return keys
}

function findProviderModel(providers: ProviderWithModels[], ref: string) {
  const [providerId, ...modelParts] = ref.split('/')
  const modelId = modelParts.join('/')
  const provider = providers.find((candidate) => candidate.id === providerId)
  const model = provider?.models.find((candidate) => candidate.key === modelId || candidate.id === modelId)
  return provider && model ? { value: providerModelRef(provider, model), label: model.name || modelId } : { value: ref, label: modelId || ref }
}

/** Builds schedule model options with the default, favorite, and recent models ahead of the provider groups. */
export function buildScheduleModelOptions(
  providers: ProviderWithModels[],
  modelState: OpenCodeModelState | undefined,
  defaultModel: string | null | undefined,
): ComboboxOption[] {
  const normalizedDefault = normalizeModel(defaultModel)
  const defaultModelMatch = normalizedDefault ? findProviderModel(providers, normalizedDefault) : null
  const sectionOptions = buildModelSections(providers, modelState).flatMap((section) =>
    section.options
      .filter((option) => option.value !== defaultModelMatch?.value)
      .map((option) => ({
        value: option.value,
        label: option.label,
        description: option.value,
        group: section.title,
      })),
  )

  if (!normalizedDefault || !defaultModelMatch) return sectionOptions
  return [
    { value: normalizedDefault, label: defaultModelMatch.label, description: normalizedDefault, group: 'Default' },
    ...sectionOptions,
  ]
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
