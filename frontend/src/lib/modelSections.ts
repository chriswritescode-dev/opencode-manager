import { Clock, Star, type LucideIcon } from 'lucide-react'
import type { ComboboxOption } from '@/components/ui/combobox'
import {
  formatModelName,
  formatProviderName,
  providerModelRef,
  type Model,
  type ModelSelection,
  type OpenCodeModelState,
  type Provider,
} from '@/api/providers'
import { compareCatalogModels, parseOpenCodeModelRef } from '@opencode-manager/shared/opencode'

export interface ModelOption {
  value: string
  label: string
  providerID: string
  modelID: string
  providerName: string
  model: Model
  searchText: string
}

export interface ModelSection {
  key: string
  title: string
  icon?: LucideIcon
  providerID?: string
  options: ModelOption[]
}

function createOption(provider: Provider, model: Model, value: string): ModelOption {
  const label = formatModelName(model)
  const providerName = formatProviderName(provider)
  return {
    value,
    label,
    providerID: provider.id,
    modelID: model.key ?? model.id,
    providerName,
    model,
    searchText: `${label} ${value} ${providerName}`.toLowerCase(),
  }
}

export function buildModelSections(
  providers: Provider[],
  modelState: OpenCodeModelState | undefined,
  defaultModel?: string | null,
): ModelSection[] {
  const optionsByValue = new Map<string, ModelOption>()
  const providerSections = providers.map((provider): ModelSection => {
    const options = provider.models.map((model) => {
      const option = createOption(provider, model, providerModelRef(provider, model))
      optionsByValue.set(option.value, option)
      return option
    })
    return { key: `provider:${provider.id}`, providerID: provider.id, title: formatProviderName(provider), options }
  })

  const pinnedValues = new Set<string>()

  const pinOptions = (selections: ModelSelection[] = []) =>
    selections.flatMap((selection) => {
      const option = optionsByValue.get(providerModelRef({ id: selection.providerID }, { id: selection.modelID }))
      if (!option || pinnedValues.has(option.value)) return []
      pinnedValues.add(option.value)
      return [option]
    })

  const favoriteOptions = pinOptions(modelState?.favorite)

  const defaultOption = (() => {
    if (!defaultModel) return undefined
    const parsed = parseOpenCodeModelRef(defaultModel)
    if (!parsed) return undefined
    const provider = providers.find((entry) => entry.id === parsed.providerID)
    const model = provider?.models.find((entry) => (entry.key ?? entry.id) === parsed.id)
    if (!provider || !model) return undefined
    if (!parsed.variant) pinnedValues.add(providerModelRef(provider, model))
    return createOption(provider, model, defaultModel)
  })()

  const recentOptions = pinOptions(modelState?.recent)
  const sections: ModelSection[] = [
    ...(defaultOption ? [{ key: 'default', title: 'Default', options: [defaultOption] }] : []),
    { key: 'favorites', title: 'Favorites', icon: Star, options: favoriteOptions },
    { key: 'recent', title: 'Recent', icon: Clock, options: recentOptions },
    ...providerSections.map((section) => ({
      ...section,
      options: section.options.filter((option) => !pinnedValues.has(option.value)),
    })),
  ]
  return sections.filter((section) => section.options.length > 0)
}

/** Keeps the first option for each value, so a favorite that is also the default lists once under Default. */
function uniqueModelSections(sections: ModelSection[]): ModelSection[] {
  const seen = new Set<string>()
  return sections
    .map((section) => ({
      ...section,
      options: section.options.filter((option) => {
        if (seen.has(option.value)) return false
        seen.add(option.value)
        return true
      }),
    }))
    .filter((section) => section.options.length > 0)
}

function compareSearchMatches(a: ModelOption, b: ModelOption): number {
  return compareCatalogModels(
    { name: a.label, free: a.model.free, released: a.model.released },
    { name: b.label, free: b.model.free, released: b.model.released },
  )
}

export function filterModelSections(sections: ModelSection[], query: string): ModelSection[] {
  const unique = uniqueModelSections(sections)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return unique

  const favoriteValues = new Set(
    sections.find((section) => section.key === 'favorites')?.options.map((option) => option.value) ?? [],
  )
  const matches = unique
    .flatMap((section) => section.options)
    .filter((option) => terms.every((term) => option.searchText.includes(term)))
    .sort(compareSearchMatches)
  const results = [
    ...matches.filter((option) => favoriteValues.has(option.value)),
    ...matches.filter((option) => !favoriteValues.has(option.value)),
  ]
  if (results.length === 0) return []
  return [{ key: 'results', title: 'Results', options: results }]
}

export function toModelComboboxOptions(sections: ModelSection[], defaultRef?: string | null): ComboboxOption[] {
  return uniqueModelSections(sections).flatMap((section) =>
    section.options.map((option) => {
      const isDefault = defaultRef != null && option.value === defaultRef
      return {
        value: isDefault ? '' : option.value,
        label: isDefault ? `Default: ${option.label}` : option.label,
        description: isDefault ? undefined : option.value,
        group: section.title,
      }
    }),
  )
}
