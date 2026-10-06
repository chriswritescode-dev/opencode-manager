import { Clock, Star, type LucideIcon } from 'lucide-react'
import {
  formatModelName,
  formatProviderName,
  providerModelRef,
  type ModelSelection,
  type OpenCodeModelState,
  type ProviderWithModels,
} from '@/api/providers'

export interface ModelOption {
  value: string
  label: string
  providerName: string
  searchText: string
}

export interface ModelSection {
  key: string
  title: string
  icon?: LucideIcon
  pinned: boolean
  options: ModelOption[]
}

export function buildModelSections(providers: ProviderWithModels[], modelState: OpenCodeModelState | undefined): ModelSection[] {
  const optionsByValue = new Map<string, ModelOption>()
  const providerSections = providers.map((provider): ModelSection => {
    const providerName = formatProviderName(provider)
    const options = provider.models.map((model) => {
      const label = formatModelName(model)
      const value = providerModelRef(provider, model)
      const option = { value, label, providerName, searchText: `${label} ${value} ${providerName}`.toLowerCase() }
      optionsByValue.set(value, option)
      return option
    })
    return { key: `provider:${provider.id}`, title: providerName, pinned: false, options }
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
  const recentOptions = pinOptions(modelState?.recent)
  const sections: ModelSection[] = [
    { key: 'favorites', title: 'Favorites', icon: Star, pinned: true, options: favoriteOptions },
    { key: 'recent', title: 'Recent', icon: Clock, pinned: true, options: recentOptions },
    ...providerSections.map((section) => ({
      ...section,
      options: section.options.filter((option) => !pinnedValues.has(option.value)),
    })),
  ]
  return sections.filter((section) => section.options.length > 0)
}

export function filterModelSections(sections: ModelSection[], query: string): ModelSection[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return sections

  return sections
    .map((section) => ({
      ...section,
      options: section.options.filter((option) => terms.every((term) => option.searchText.includes(term))),
    }))
    .filter((section) => section.options.length > 0)
}
