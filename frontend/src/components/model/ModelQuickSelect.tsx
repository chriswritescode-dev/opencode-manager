import { useCallback, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Search, Star, X } from 'lucide-react'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useVariants } from '@/hooks/useVariants'
import { formatModelName, formatProviderName, getProviders } from '@/api/providers'
import { useQuery } from '@tanstack/react-query'
import { useOpenCodeClient } from '@/hooks/useOpenCode'
import { BottomSheet, BottomSheetContent } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { Model, Provider } from '@/api/providers'

interface ModelQuickSelectProps {
  opcodeUrl: string | null | undefined
  directory?: string
  disabled?: boolean
  children: React.ReactNode
}

interface ModelListItem {
  providerID: string
  modelID: string
  key: string
  displayName: string
  providerName: string
  model?: Model
}

interface ModelSection {
  title: string
  icon: React.ReactNode
  models: ModelListItem[]
}

interface ProviderListItem {
  id: string
  label: string
  count: number
}

export function ModelQuickSelect({
  opcodeUrl,
  directory,
  disabled,
  children,
}: ModelQuickSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAllModels, setShowAllModels] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const { model, modelString, recentModels, favoriteModels, setModel, toggleFavorite } = useModelSelection(opcodeUrl, directory)
  const { availableVariants, currentVariant, setVariant, clearVariant, hasVariants } = useVariants(opcodeUrl, directory)
  const client = useOpenCodeClient(opcodeUrl, directory)

   const { data: providersData } = useQuery({
     queryKey: ['opencode', 'providers', opcodeUrl, directory],
     queryFn: () => getProviders(directory),
     enabled: !!client,
     staleTime: 30000,
   })

   const getDisplayName = useCallback((providerID: string, modelID: string) => {
     const modelData = providersData?.providers
        .find(provider => provider.id === providerID)
        ?.models?.[modelID]
     return modelData ? formatModelName(modelData) : modelID
   }, [providersData])

   const getProviderName = useCallback((providerID: string) => {
     const provider = providersData?.providers.find(provider => provider.id === providerID)
     return provider ? formatProviderName(provider) : providerID
   }, [providersData])

    const getModelData = useCallback((providerID: string, modelID: string) => {
      return providersData?.providers
        .find(provider => provider.id === providerID)
        ?.models?.[modelID]
    }, [providersData])

    const toModelListItem = useCallback((selection: { providerID: string, modelID: string }): ModelListItem => ({
      ...selection,
      displayName: getDisplayName(selection.providerID, selection.modelID),
      providerName: getProviderName(selection.providerID),
      key: `${selection.providerID}/${selection.modelID}`,
      model: getModelData(selection.providerID, selection.modelID),
    }), [getDisplayName, getModelData, getProviderName])

    const favoriteModelsWithNames = useMemo(() => {
      return favoriteModels
        .filter(favorite => `${favorite.providerID}/${favorite.modelID}` !== modelString)
        .slice(0, 5)
        .map(toModelListItem)
    }, [favoriteModels, modelString, toModelListItem])

    const recentModelsWithNames = useMemo(() => {
      return recentModels
        .filter(recent => {
          const key = `${recent.providerID}/${recent.modelID}`
          return key !== modelString && !favoriteModels.some(favorite => favorite.providerID === recent.providerID && favorite.modelID === recent.modelID)
        })
        .slice(0, 5)
        .map(toModelListItem)
    }, [recentModels, favoriteModels, modelString, toModelListItem])

  const allModels = useMemo((): ModelListItem[] => {
    return providersData?.providers.flatMap((provider: Provider) => Object.entries(provider.models || {}).map(([modelID, providerModel]) => ({
      providerID: provider.id,
      modelID,
      key: `${provider.id}/${modelID}`,
      displayName: formatModelName(providerModel),
      providerName: formatProviderName(provider),
      model: providerModel,
    }))) || []
  }, [providersData])

  const quickModels = useMemo(() => {
    const items = [
      ...(model ? [toModelListItem(model)] : []),
      ...favoriteModelsWithNames,
      ...recentModelsWithNames,
      ...allModels,
    ]

    return items.filter((item, index, list) => list.findIndex(candidate => candidate.key === item.key) === index).slice(0, 3)
  }, [allModels, favoriteModelsWithNames, model, recentModelsWithNames, toModelListItem])

  const quickSections = useMemo((): ModelSection[] => {
    const sections: ModelSection[] = []

    if (favoriteModelsWithNames.length > 0) {
      sections.push({
        title: 'Favorites',
        icon: <Star className="h-3.5 w-3.5" />,
        models: favoriteModelsWithNames,
      })
    }

    if (recentModelsWithNames.length > 0) {
      sections.push({
        title: 'Recent',
        icon: <Clock className="h-3.5 w-3.5" />,
        models: recentModelsWithNames,
      })
    }

    if (sections.length === 0 && quickModels.length > 0) {
      sections.push({
        title: 'Models',
        icon: <ChevronRight className="h-3.5 w-3.5" />,
        models: quickModels,
      })
    }

    return sections
  }, [favoriteModelsWithNames, quickModels, recentModelsWithNames])

  const selectedProviderModels = useMemo(() => {
    if (!selectedProviderId) return []

    return allModels.filter(item => item.providerID === selectedProviderId)
  }, [allModels, selectedProviderId])

  const filteredSelectedProviderModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return selectedProviderModels

    return selectedProviderModels.filter(item =>
      item.displayName.toLowerCase().includes(query) ||
      item.modelID.toLowerCase().includes(query)
    )
  }, [searchQuery, selectedProviderModels])

  const providerItems = useMemo((): ProviderListItem[] => {
    return providersData?.providers
      .map(provider => ({
        id: provider.id,
        label: formatProviderName(provider),
        count: Object.keys(provider.models || {}).length,
      }))
      .filter(provider => provider.count > 0)
      .sort((a, b) => a.label.localeCompare(b.label)) || []
  }, [providersData])

  const filteredAllModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const items = selectedProviderId
      ? allModels.filter(item => item.providerID === selectedProviderId)
      : allModels

    if (!query) return items

    return items.filter(item =>
      item.displayName.toLowerCase().includes(query) ||
      item.modelID.toLowerCase().includes(query)
    )
  }, [allModels, selectedProviderId, searchQuery])

  const filteredProviderItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return providerItems

    return providerItems.filter(provider =>
      provider.label.toLowerCase().includes(query) ||
      provider.id.toLowerCase().includes(query)
    )
  }, [providerItems, searchQuery])

  const handleModelSelect = (providerID: string, modelID: string) => {
    setModel({ providerID, modelID })
    setIsOpen(false)
  }

  const handleCurrentFavoriteToggle = () => {
    if (!model) return
    toggleFavorite(model)
  }

  const isCurrentFavorite = model
    ? favoriteModels.some((favorite) => favorite.providerID === model.providerID && favorite.modelID === model.modelID)
    : false

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setShowAllModels(false)
      setSearchQuery('')
      setSelectedProviderId(null)
    }
  }

  const handleProviderSelect = (providerID: string) => {
    setSelectedProviderId(providerID)
    setSearchQuery('')
  }

  const getDescription = (item: ModelListItem) => {
    const context = item.model?.limit?.context
    if (context) {
      const formattedContext = context >= 1000000 ? `${(context / 1000000).toFixed(1)}M` : context.toLocaleString()
      return `${item.providerName} · ${formattedContext} context`
    }

    return item.providerName
  }

  const getPrimaryLabel = (item: ModelListItem) => item.displayName || item.modelID

  const renderModelOption = (item: ModelListItem) => {
    const isSelected = modelString === item.key
    const isFavorite = favoriteModels.some(favorite => favorite.providerID === item.providerID && favorite.modelID === item.modelID)

    return (
      <div
        key={item.key}
        className={`group flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 ${isSelected ? 'bg-orange-500/10' : ''}`}
      >
        <button
          type="button"
          onClick={() => handleModelSelect(item.providerID, item.modelID)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-medium text-white">
            {getPrimaryLabel(item)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-white/50">
            {getDescription(item)}
          </span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            toggleFavorite({ providerID: item.providerID, modelID: item.modelID })
          }}
          className="rounded-full p-1.5 text-white/50 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100 md:opacity-100"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={`h-4 w-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
        </button>
        {isSelected && <Check className="h-5 w-5 shrink-0 text-orange-500" />}
      </div>
    )
  }

  const selectedModelItem = model ? toModelListItem(model) : null

  const renderProviderOption = (provider: ProviderListItem) => {
    return (
      <button
        key={provider.id}
        type="button"
        onClick={() => handleProviderSelect(provider.id)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/5"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{provider.label}</span>
          <span className="mt-0.5 block truncate text-xs text-white/50">{provider.count} {provider.count === 1 ? 'model' : 'models'}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-white/40" />
      </button>
    )
  }

  const renderVariantControls = () => {
    if (!hasVariants) return null

    const selectedVariantLabel = currentVariant || 'Default'

    return (
      <div className="mx-2 mt-2">
        <p className="mb-1.5 px-1 text-xs font-medium text-white/45">Variant</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 w-full justify-between gap-1 border-white/10 bg-white/[0.03] px-3 text-sm capitalize text-orange-300 hover:border-orange-500/30 hover:bg-orange-500/10 hover:text-orange-200">
              {selectedVariantLabel}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[350]">
            <DropdownMenuItem onClick={() => clearVariant()} className={!currentVariant ? 'text-orange-500' : ''}>
              Default
              {!currentVariant && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
            {availableVariants.map(variant => (
              <DropdownMenuItem key={variant} onClick={() => setVariant(variant)} className={currentVariant === variant ? 'text-orange-500' : ''}>
                <span className="capitalize">{variant}</span>
                {currentVariant === variant && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  const handleMoreModelsBack = () => {
    if (selectedProviderId) {
      setSelectedProviderId(null)
      setSearchQuery('')
      return
    }

    setShowAllModels(false)
  }

  const selectedProviderLabel = selectedProviderId
    ? providerItems.find(provider => provider.id === selectedProviderId)?.label || selectedProviderId
    : null

  return (
    <>
      <span onClick={() => !disabled && handleOpenChange(true)} data-model-select-trigger>
        {children}
      </span>
      <BottomSheet
        isOpen={isOpen}
        onClose={() => handleOpenChange(false)}
        heightClass="h-[70dvh] max-h-[720px]"
        className="z-[300] border-white/10 bg-zinc-950 text-white shadow-2xl"
        ariaLabel="Select model"
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-0">
          <button
            type="button"
            onClick={() => showAllModels ? handleMoreModelsBack() : handleOpenChange(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
            aria-label={showAllModels ? 'Back to quick models' : 'Close model selector'}
          >
            {showAllModels ? <ChevronLeft className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </button>
          <h2 className="text-base font-semibold tracking-tight">{showAllModels ? selectedProviderLabel || 'More models' : 'Select model'}</h2>
          <button
            type="button"
            onClick={handleCurrentFavoriteToggle}
            disabled={!model}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 disabled:opacity-30"
            aria-label={isCurrentFavorite ? 'Remove current model from favorites' : 'Add current model to favorites'}
          >
            <Star className={`h-4 w-4 ${isCurrentFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
          </button>
        </div>

        {showAllModels ? (
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Provider sidebar — desktop only */}
            <div className="hidden md:flex md:flex-col w-48 lg:w-56 border-r border-white/10 overflow-y-auto flex-shrink-0">
              <div className="p-3 space-y-1">
                {providerItems.map(provider => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => handleProviderSelect(provider.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedProviderId === provider.id
                        ? 'bg-orange-500/20 text-orange-300 font-medium'
                        : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <div className="truncate">{provider.label}</div>
                    <div className="text-xs text-white/40">{provider.count} {provider.count === 1 ? 'model' : 'models'}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right panel */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Search bar */}
              <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950 px-4 pb-3 pt-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={selectedProviderId ? 'Search models...' : 'Search models...'}
                    className="h-9 border-white/10 bg-white/5 pl-9 text-sm text-white placeholder:text-white/40"
                    autoComplete="off"
                    name="model-search"
                  />
                </div>
                <p className="text-xs text-white/45">
                  <span className="hidden md:inline">{filteredAllModels.length} model{filteredAllModels.length !== 1 ? 's' : ''}</span>
                  <span className="md:hidden">
                    {selectedProviderId
                      ? `${filteredSelectedProviderModels.length} model${filteredSelectedProviderModels.length !== 1 ? 's' : ''}`
                      : `${filteredProviderItems.length} provider${filteredProviderItems.length !== 1 ? 's' : ''}`}
                  </span>
                  {searchQuery && ` matching "${searchQuery}"`}
                </p>
              </div>

              {/* Desktop: model grid */}
              <div className="hidden md:block flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-1">{filteredAllModels.map(renderModelOption)}</div>
                {filteredAllModels.length === 0 && (
                  <div className="py-10 text-center text-sm text-white/50">No models found</div>
                )}
              </div>

              {/* Mobile: current single-column navigation */}
              <div className="md:hidden flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-1">
                  {selectedProviderId
                    ? filteredSelectedProviderModels.map(renderModelOption)
                    : filteredProviderItems.map(renderProviderOption)}
                </div>
                {selectedProviderId && filteredSelectedProviderModels.length === 0 && (
                  <div className="py-10 text-center text-sm text-white/50">No models found</div>
                )}
                {!selectedProviderId && filteredProviderItems.length === 0 && (
                  <div className="py-10 text-center text-sm text-white/50">No providers found</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <BottomSheetContent className="px-4 pb-5 pt-0">
            <div className="space-y-4">
              {selectedModelItem && (
                <div>
                  {renderModelOption(selectedModelItem)}
                  {renderVariantControls()}
                  <div className="mx-2 mt-4 border-t border-white/10" />
                </div>
              )}
              {quickSections.map(section => (
                <section key={section.title}>
                  <h3 className="mb-1.5 flex items-center gap-1.5 px-2 text-xs font-medium text-white/45">
                    {section.icon}
                    {section.title}
                  </h3>
                  <div className="space-y-1">
                    {section.models.map(renderModelOption)}
                  </div>
                </section>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowAllModels(true)}
              className="mt-3 flex w-full items-center justify-between border-t border-white/10 pt-3 text-left text-sm font-medium text-white hover:text-white/80"
            >
              <span>More models</span>
              <ChevronRight className="h-5 w-5 text-white/50" />
            </button>
          </BottomSheetContent>
        )}
      </BottomSheet>
    </>
  )
}
