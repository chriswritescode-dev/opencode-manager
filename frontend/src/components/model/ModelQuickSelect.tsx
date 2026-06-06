import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, MoreVertical, Search, Star, Trash2, X } from 'lucide-react'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useVariants } from '@/hooks/useVariants'
import { formatModelName, formatProviderName, getProviders } from '@/api/providers'
import { useQuery } from '@tanstack/react-query'
import { useOpenCodeClient } from '@/hooks/useOpenCode'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  searchText: string
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
  isConnected: boolean
  searchText: string
}

interface VirtualizedListProps<T> {
  items: T[]
  itemHeight: number
  renderItem: (item: T) => React.ReactNode
  getKey: (item: T) => string
  emptyLabel: string
  className?: string
  resetKey?: string
  overscan?: number
}

const MODEL_OPTION_ROW_HEIGHT = 60
const VIRTUAL_LIST_OVERSCAN = 8
const EMPTY_PROVIDERS: Provider[] = []
const EMPTY_MODELS: ModelListItem[] = []
const EMPTY_MODELS_BY_PROVIDER = new Map<string, ModelListItem[]>()

function createSearchText(...values: string[]) {
  return values.join(' ').toLowerCase()
}

function createModelListItem(provider: Provider, modelID: string, model: Model): ModelListItem {
  const providerName = formatProviderName(provider)
  const displayName = formatModelName(model)

  return {
    providerID: provider.id,
    modelID,
    key: `${provider.id}/${modelID}`,
    displayName,
    providerName,
    searchText: createSearchText(displayName, modelID, providerName, provider.id),
    model,
  }
}

function createFallbackModelListItem(providerID: string, modelID: string): ModelListItem {
  return {
    providerID,
    modelID,
    key: `${providerID}/${modelID}`,
    displayName: modelID,
    providerName: providerID,
    searchText: createSearchText(modelID, providerID),
  }
}

function getSelectionKey(selection: { providerID: string, modelID: string }) {
  return `${selection.providerID}/${selection.modelID}`
}

function VirtualizedList<T>({
  items,
  itemHeight,
  renderItem,
  getKey,
  emptyLabel,
  className,
  resetKey,
  overscan = VIRTUAL_LIST_OVERSCAN,
}: VirtualizedListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const updateViewportHeight = () => setViewportHeight(element.clientHeight)
    updateViewportHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportHeight)
      return () => window.removeEventListener('resize', updateViewportHeight)
    }

    const resizeObserver = new ResizeObserver(updateViewportHeight)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = 0
    setScrollTop(0)
  }, [resetKey])

  const visibleRange = useMemo(() => {
    if (items.length === 0 || viewportHeight === 0) {
      return { start: 0, end: 0 }
    }

    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2
    return {
      start,
      end: Math.min(items.length, start + visibleCount),
    }
  }, [itemHeight, items.length, overscan, scrollTop, viewportHeight])

  const visibleItems = useMemo(
    () => items.slice(visibleRange.start, visibleRange.end),
    [items, visibleRange.end, visibleRange.start]
  )

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className={['h-full overflow-y-auto', className].filter(Boolean).join(' ')}
    >
      {items.length === 0 ? (
        <div className="py-10 text-center text-sm text-white/50">{emptyLabel}</div>
      ) : (
        <div className="relative" style={{ height: items.length * itemHeight }}>
          {visibleItems.map((item, index) => (
            <div
              key={getKey(item)}
              className="absolute left-0 right-0"
              style={{
                top: (visibleRange.start + index) * itemHeight,
                height: itemHeight,
              }}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const { model, modelString, recentModels, favoriteModels, setModel, toggleFavorite, removeRecentModel } = useModelSelection(opcodeUrl, directory)
  const { availableVariants, currentVariant, setVariant, clearVariant, hasVariants } = useVariants(opcodeUrl, directory)
  const client = useOpenCodeClient(opcodeUrl, directory)

  const { data: providersData } = useQuery({
    queryKey: ['opencode', 'providers', opcodeUrl, directory],
    queryFn: () => getProviders(directory),
    enabled: !!client,
    staleTime: 30000,
  })

  const providers = providersData?.providers ?? EMPTY_PROVIDERS

  const favoriteKeySet = useMemo(() => {
    return new Set(favoriteModels.map(getSelectionKey))
  }, [favoriteModels])

  const recentKeySet = useMemo(() => {
    return new Set(recentModels.map(getSelectionKey))
  }, [recentModels])

  const { providerById, providerItems } = useMemo(() => {
    const nextProviderById = new Map<string, Provider>()
    const nextProviderItems: ProviderListItem[] = []

    for (const provider of providers) {
      const providerName = formatProviderName(provider)
      const count = Object.keys(provider.models || {}).length
      nextProviderById.set(provider.id, provider)

      if (count > 0) {
        nextProviderItems.push({
          id: provider.id,
          label: providerName,
          count,
          isConnected: provider.isConnected ?? false,
          searchText: createSearchText(providerName, provider.id),
        })
      }
    }

    nextProviderItems.sort((a, b) => {
      if (a.isConnected !== b.isConnected) {
        return a.isConnected ? -1 : 1
      }
      return a.label.localeCompare(b.label)
    })

    return {
      providerById: nextProviderById,
      providerItems: nextProviderItems,
    }
  }, [providers])

  const toModelListItem = useCallback((selection: { providerID: string, modelID: string }): ModelListItem => {
    const provider = providerById.get(selection.providerID)
    const providerModel = provider?.models?.[selection.modelID]

    if (!provider || !providerModel) {
      return createFallbackModelListItem(selection.providerID, selection.modelID)
    }

    return createModelListItem(provider, selection.modelID, providerModel)
  }, [providerById])

  const quickFallbackModels = useMemo(() => {
    const result: ModelListItem[] = []

    for (const providerItem of providerItems) {
      const provider = providerById.get(providerItem.id)
      if (!provider) continue

      for (const [modelID, providerModel] of Object.entries(provider.models || {})) {
        result.push(createModelListItem(provider, modelID, providerModel))
        if (result.length === 3) return result
      }
    }

    return result
  }, [providerById, providerItems])

  const { allModels, modelsByProviderId } = useMemo(() => {
    if (!showAllModels) {
      return {
        allModels: EMPTY_MODELS,
        modelsByProviderId: EMPTY_MODELS_BY_PROVIDER,
      }
    }

    const nextAllModels: ModelListItem[] = []
    const nextModelsByProviderId = new Map<string, ModelListItem[]>()

    for (const provider of providers) {
      const providerModels: ModelListItem[] = []

      for (const [modelID, providerModel] of Object.entries(provider.models || {})) {
        const item = createModelListItem(provider, modelID, providerModel)
        nextAllModels.push(item)
        providerModels.push(item)
      }

      if (providerModels.length > 0) {
        nextModelsByProviderId.set(provider.id, providerModels)
      }
    }

    return {
      allModels: nextAllModels,
      modelsByProviderId: nextModelsByProviderId,
    }
  }, [providers, showAllModels])

  const favoriteModelsWithNames = useMemo(() => {
    return favoriteModels
      .filter(favorite => `${favorite.providerID}/${favorite.modelID}` !== modelString)
      .slice(0, 5)
      .map(toModelListItem)
  }, [favoriteModels, modelString, toModelListItem])

  const recentModelsWithNames = useMemo(() => {
    return recentModels
      .filter(recent => {
        const key = getSelectionKey(recent)
        return key !== modelString && !favoriteKeySet.has(key)
      })
      .slice(0, 5)
      .map(toModelListItem)
  }, [favoriteKeySet, recentModels, modelString, toModelListItem])

  const quickModels = useMemo(() => {
    const items = [
      ...(model ? [toModelListItem(model)] : []),
      ...favoriteModelsWithNames,
      ...recentModelsWithNames,
      ...quickFallbackModels,
    ]
    const seenKeys = new Set<string>()
    const result: ModelListItem[] = []

    for (const item of items) {
      if (seenKeys.has(item.key)) continue
      seenKeys.add(item.key)
      result.push(item)
      if (result.length === 3) break
    }

    return result
  }, [favoriteModelsWithNames, model, quickFallbackModels, recentModelsWithNames, toModelListItem])

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

    return modelsByProviderId.get(selectedProviderId) ?? []
  }, [modelsByProviderId, selectedProviderId])

  const filteredSelectedProviderModels = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    if (!query) return selectedProviderModels

    return selectedProviderModels.filter(item => item.searchText.includes(query))
  }, [deferredSearchQuery, selectedProviderModels])

  const filteredAllModels = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    const items = selectedProviderId
      ? selectedProviderModels
      : allModels

    if (!query) return items

    return items.filter(item => item.searchText.includes(query))
  }, [allModels, deferredSearchQuery, selectedProviderId, selectedProviderModels])

  const filteredProviderItems = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    if (!query) return providerItems

    return providerItems.filter(provider => provider.searchText.includes(query))
  }, [deferredSearchQuery, providerItems])

  const connectedProviderItems = useMemo(
    () => filteredProviderItems.filter(p => p.isConnected),
    [filteredProviderItems]
  )

  const availableProviderItems = useMemo(
    () => filteredProviderItems.filter(p => !p.isConnected),
    [filteredProviderItems]
  )

  const handleModelSelect = (providerID: string, modelID: string) => {
    setModel({ providerID, modelID })
    setShowAllModels(false)
    setSearchQuery('')
    setSelectedProviderId(null)
  }

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
    const isFavorite = favoriteKeySet.has(item.key)
    const isRecent = recentKeySet.has(item.key)

    return (
      <div
        key={item.key}
        className={`group flex w-full items-center gap-2 rounded-xl py-2 text-left transition-colors hover:bg-white/5 ${isSelected ? 'bg-orange-500/10' : ''}`}
      >
        <button
          type="button"
          onClick={() => handleModelSelect(item.providerID, item.modelID)}
          className="min-w-0 flex-1 px-2 text-left"
        >
          <span className="block truncate text-sm font-medium text-white">
            {getPrimaryLabel(item)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-white/50">
            {getDescription(item)}
          </span>
        </button>
        {isRecent && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              removeRecentModel({ providerID: item.providerID, modelID: item.modelID })
            }}
            className="rounded-full p-1.5 text-white/30 hover:bg-white/10 hover:text-white/70"
            aria-label="Remove from recent"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            toggleFavorite({ providerID: item.providerID, modelID: item.modelID })
          }}
          className="rounded-full p-1.5 text-white/50 transition-opacity hover:bg-white/10 hover:text-white"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={`h-4 w-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
        </button>
        {isSelected && <Check className="h-5 w-5 shrink-0 pr-2 text-orange-500" />}
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
        className="flex w-full items-center gap-3 rounded-xl py-2.5 text-left transition-colors hover:bg-white/5"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{provider.label}</span>
          <span className="mt-0.5 block truncate text-xs text-white/50">{provider.count} {provider.count === 1 ? 'model' : 'models'}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-white/40" />
      </button>
    )
  }

  const renderVariantMenuItems = () => {
    if (!hasVariants) return null

    return (
      <>
        <DropdownMenuLabel>Variant</DropdownMenuLabel>
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
      </>
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

  const selectedModelLabel = selectedModelItem ? getPrimaryLabel(selectedModelItem) : 'Select model'
  const selectedModelDescription = selectedModelItem ? getDescription(selectedModelItem) : 'Choose a model'

  return (
    <>
      <span onClick={() => !disabled && handleOpenChange(true)} data-model-select-trigger>
        {children}
      </span>
      <BottomSheet
        isOpen={isOpen}
        onClose={() => handleOpenChange(false)}
        heightClass="h-[70dvh] max-h-[720px]"
        className="z-[300] border-white/10 bg-zinc-950 text-white shadow-2xl md:mx-auto md:max-w-lg"
        ariaLabel="Select model"
      >
        <div className={`flex items-center justify-between gap-2 px-4 ${showAllModels ? 'pb-2 pt-2' : 'pb-3 pt-0'}`}>
          {showAllModels ? (
            <>
              <button
                type="button"
                onClick={handleMoreModelsBack}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                aria-label="Back to quick models"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={selectedProviderId ? 'Search models...' : 'Search providers...'}
                  className="h-9 border-white/10 bg-white/5 pl-9 text-sm text-white placeholder:text-white/40"
                  autoComplete="off"
                  name="model-search"
                />
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                aria-label="Close model selector"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1 px-3 text-center">
                <h2 className="truncate text-base font-semibold tracking-tight">
                  {selectedModelLabel}
                  <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-orange-500" />
                </h2>
                <p className="truncate text-xs text-white/45">
                  {currentVariant ? `${selectedModelDescription} · ${currentVariant}` : selectedModelDescription}
                </p>
              </div>
              {hasVariants && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={!model && !hasVariants}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 disabled:opacity-30"
                      aria-label="Model actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[350] min-w-56">
                    {renderVariantMenuItems()}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>

        {showAllModels ? (
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Provider sidebar — desktop only */}
            <div className="hidden md:flex md:flex-col w-48 lg:w-56 border-r border-white/10 overflow-y-auto flex-shrink-0">
              <div className="p-3 space-y-1">
                {connectedProviderItems.length > 0 && (
                  <>
                    <p className="px-3 pb-1 text-xs font-medium text-white/45">Connected</p>
                    {connectedProviderItems.map(provider => (
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
                    {availableProviderItems.length > 0 && <div className="mx-3 my-1 h-px bg-white/10" />}
                  </>
                )}
                {availableProviderItems.length > 0 && (
                  <>
                    <p className="px-3 pb-1 text-xs font-medium text-white/45">Available</p>
                    {availableProviderItems.map(provider => (
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
                  </>
                )}
              </div>
            </div>

            {/* Right panel */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Desktop: model grid */}
              <div className="hidden md:block flex-1 overflow-hidden min-h-0">
                <VirtualizedList
                  items={filteredAllModels}
                  itemHeight={MODEL_OPTION_ROW_HEIGHT}
                  renderItem={(item) => renderModelOption(item)}
                  getKey={(item) => item.key}
                  emptyLabel="No models found"
                  className="px-4 pb-4 pt-2"
                  resetKey={`${selectedProviderId ?? 'all'}:${deferredSearchQuery}`}
                />
              </div>

              {/* Mobile: current single-column navigation */}
              <div className="md:hidden flex-1 overflow-hidden min-h-0">
                {selectedProviderId ? (
                  <VirtualizedList
                    items={filteredSelectedProviderModels}
                    itemHeight={MODEL_OPTION_ROW_HEIGHT}
                    renderItem={(item) => renderModelOption(item)}
                    getKey={(item) => item.key}
                    emptyLabel="No models found"
                    className="px-4 pb-4"
                    resetKey={`${selectedProviderId}:${deferredSearchQuery}`}
                  />
                ) : (
                  <div className="h-full overflow-y-auto px-4 pb-4">
                    <div className="space-y-1">
                      {connectedProviderItems.length > 0 && (
                        <>
                          <p className="px-1 pb-1 text-xs font-medium text-white/45">Connected</p>
                          {connectedProviderItems.map(renderProviderOption)}
                          {availableProviderItems.length > 0 && <div className="-mx-4 my-2 h-px bg-white/10" />}
                        </>
                      )}
                      {availableProviderItems.length > 0 && (
                        <>
                          <p className="px-1 pb-1 text-xs font-medium text-white/45">Available</p>
                          {availableProviderItems.map(renderProviderOption)}
                        </>
                      )}
                    </div>
                    {filteredProviderItems.length === 0 && (
                      <div className="py-10 text-center text-sm text-white/50">No providers found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-safe pt-0">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
              {quickSections.map(section => (
                <section key={section.title}>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/45">
                    {section.icon}
                    {section.title}
                  </h3>
                  <div className="space-y-1">
                    {section.models.map(item => renderModelOption(item))}
                  </div>
                </section>
              ))}
            </div>
            <div className="flex-shrink-0 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowAllModels(true)}
                className="flex w-full items-center justify-between bg-card px-6 py-4 text-left text-sm font-semibold text-white transition-colors hover:bg-accent active:bg-card"
              >
                <span>More models</span>
                <ChevronRight className="h-5 w-5 text-white/50" />
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  )
}
