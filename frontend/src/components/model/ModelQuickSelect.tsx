import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, Star, Trash2, X, type LucideIcon } from 'lucide-react'
import { useModelSelection, type ModelSelectionSession } from '@/hooks/useModelSelection'
import { useModelSections } from '@/hooks/useModelSections'
import { useVariants } from '@/hooks/useVariants'
import { modelSelectionRef, type Model } from '@/api/providers'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { buildModelSections, filterModelSections, type ModelOption } from '@/lib/modelSections'

interface ModelQuickSelectProps {
  directory?: string
  disabled?: boolean
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  session?: ModelSelectionSession
}

interface ModelListItem {
  providerID: string
  modelID: string
  key: string
  displayName: string
  providerName: string
  model?: Model
}

interface QuickModelSection {
  title: string
  icon?: LucideIcon
  models: ModelListItem[]
}

interface ProviderListItem {
  id: string
  label: string
  count: number
}

interface VirtualizedListProps<T> {
  items: T[]
  itemHeight: number
  renderItem: (item: T, index: number) => React.ReactNode
  getKey: (item: T) => string
  emptyLabel: string
  className?: string
  resetKey?: string
  overscan?: number
  activeIndex?: number
}

const MODEL_OPTION_ROW_HEIGHT = 60
const VIRTUAL_LIST_OVERSCAN = 8
const EMPTY_MODELS: ModelListItem[] = []
const EMPTY_PROVIDER_ITEMS: ProviderListItem[] = []
const ICON_BUTTON_CLASS =
  'flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted text-foreground/80 hover:bg-accent'

function formatModelCount(count: number) {
  return `${count} ${count === 1 ? 'model' : 'models'}`
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
  activeIndex,
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

  useEffect(() => {
    if (activeIndex === undefined) return
    const element = scrollRef.current
    if (!element) return

    const rowTop = activeIndex * itemHeight
    const rowBottom = rowTop + itemHeight
    if (rowTop < element.scrollTop) {
      element.scrollTop = rowTop
    } else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = rowBottom - element.clientHeight
    }
    setScrollTop(element.scrollTop)
  }, [activeIndex, itemHeight])

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
        <div className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</div>
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
              {renderItem(item, visibleRange.start + index)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ModelQuickSelect({
  directory,
  disabled,
  children,
  open,
  onOpenChange,
  session,
}: ModelQuickSelectProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isOpen = open ?? internalIsOpen
  const [showAllModels, setShowAllModels] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const quickListRef = useRef<HTMLDivElement>(null)
  const { model, modelString, info, recentModels, favoriteModels, setModel, toggleFavorite, removeRecentModel } = useModelSelection(directory, session)
  const { availableVariants, currentVariant, setVariant, clearVariant, hasVariants } = useVariants(directory, session)

  const { providers, sections } = useModelSections(directory)

  const catalogSections = useMemo(() => buildModelSections(providers, undefined), [providers])
  const catalogOptions = useMemo(
    () => catalogSections.flatMap((section) => section.options),
    [catalogSections],
  )

  const toModelListItem = useCallback(
    (option: ModelOption): ModelListItem => ({
      providerID: option.providerID,
      modelID: option.modelID,
      key: option.value,
      displayName: option.label,
      providerName: option.providerName,
      model: option.model,
    }),
    [],
  )

  const favoriteKeySet = useMemo(() => {
    return new Set(favoriteModels.map(modelSelectionRef))
  }, [favoriteModels])

  const recentKeySet = useMemo(() => {
    return new Set(recentModels.map(modelSelectionRef))
  }, [recentModels])

  const browseData = useMemo(() => {
    if (!showAllModels) return null

    const rowsByKey = new Map<string, ModelListItem>()
    const modelsByProviderId = new Map<string, ModelListItem[]>()
    const providerItems: ProviderListItem[] = []
    const allModels: ModelListItem[] = []

    for (const section of catalogSections) {
      if (!section.providerID) continue
      const items = section.options.map(toModelListItem)
      for (const item of items) rowsByKey.set(item.key, item)
      providerItems.push({ id: section.providerID, label: section.title, count: items.length })
      modelsByProviderId.set(section.providerID, items)
      allModels.push(...items)
    }

    return { rowsByKey, modelsByProviderId, providerItems, allModels }
  }, [showAllModels, catalogSections, toModelListItem])

  const quickSections = useMemo((): QuickModelSection[] => {
    const favorites = sections.find((section) => section.key === 'favorites')
    const recent = sections.find((section) => section.key === 'recent')
    const result: QuickModelSection[] = []

    if (favorites) {
      result.push({ title: favorites.title, icon: favorites.icon, models: favorites.options.map(toModelListItem) })
    }

    if (recent) {
      result.push({ title: recent.title, icon: recent.icon, models: recent.options.map(toModelListItem) })
    }

    if (result.length === 0) {
      const models = catalogOptions.slice(0, 3).map(toModelListItem)
      if (models.length > 0) {
        result.push({ title: 'Models', icon: ChevronRight, models })
      }
    }

    return result
  }, [sections, catalogOptions, toModelListItem])

  const isSearching = deferredSearchQuery.trim().length > 0

  const searchSections = useMemo(
    () =>
      selectedProviderId
        ? catalogSections.filter((section) => section.providerID === selectedProviderId)
        : sections,
    [selectedProviderId, catalogSections, sections],
  )

  const searchResults = useMemo(() => {
    if (!isSearching) return EMPTY_MODELS

    return filterModelSections(searchSections, deferredSearchQuery)
      .flatMap((section) => section.options)
      .map(toModelListItem)
  }, [deferredSearchQuery, isSearching, searchSections, toModelListItem])

  const providerItems = browseData?.providerItems ?? EMPTY_PROVIDER_ITEMS

  const selectedProviderModels = useMemo(
    () => (selectedProviderId ? browseData?.modelsByProviderId.get(selectedProviderId) ?? EMPTY_MODELS : EMPTY_MODELS),
    [browseData, selectedProviderId]
  )

  const browseModels = selectedProviderId ? selectedProviderModels : browseData?.allModels ?? EMPTY_MODELS

  const navigableItems = useMemo((): ModelListItem[] => {
    if (showAllModels) {
      return isSearching ? searchResults : browseModels
    }
    return quickSections.flatMap((section) => section.models)
  }, [showAllModels, isSearching, searchResults, browseModels, quickSections])

  const quickSectionOffsets = useMemo(() => {
    const offsets = new Map<string, number>()
    let running = 0
    for (const section of quickSections) {
      offsets.set(section.title, running)
      running += section.models.length
    }
    return offsets
  }, [quickSections])

  const activeResetKey = `${isOpen}|${showAllModels}|${isSearching ? deferredSearchQuery : ''}|${selectedProviderId ?? ''}`
  const navigableItemsRef = useRef(navigableItems)
  navigableItemsRef.current = navigableItems
  const modelStringRef = useRef(modelString)
  modelStringRef.current = modelString

  useEffect(() => {
    const selectedIndex = navigableItemsRef.current.findIndex((item) => item.key === modelStringRef.current)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [activeResetKey])

  useEffect(() => {
    setActiveIndex((current) => {
      if (navigableItems.length === 0) return 0
      return Math.min(current, navigableItems.length - 1)
    })
  }, [navigableItems.length])

  useEffect(() => {
    if (showAllModels) return
    const container = quickListRef.current
    if (!container) return
    const element = container.querySelector<HTMLElement>(`[data-model-index="${activeIndex}"]`)
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, showAllModels])

  const handleModelSelect = useCallback((providerID: string, modelID: string) => {
    setModel({ providerID, modelID })
    setShowAllModels(false)
    setSearchQuery('')
    setSelectedProviderId(null)
  }, [setModel])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target
      if (target instanceof HTMLElement && target.closest('[role="menu"]')) return

      const isTextInput =
        target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (event.key === 'Enter') {
        if (target instanceof HTMLElement && target.closest('button')) return
        const item = navigableItems[activeIndex]
        if (!item) return
        event.preventDefault()
        event.stopPropagation()
        handleModelSelect(item.providerID, item.modelID)
        return
      }

      let nextIndex: number | null = null
      if (event.key === 'ArrowDown') {
        nextIndex = Math.min(activeIndex + 1, navigableItems.length - 1)
      } else if (event.key === 'ArrowUp') {
        nextIndex = Math.max(activeIndex - 1, 0)
      } else if (event.key === 'Home' && !isTextInput) {
        nextIndex = 0
      } else if (event.key === 'End' && !isTextInput) {
        nextIndex = navigableItems.length - 1
      }

      if (nextIndex === null || navigableItems.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      setActiveIndex(nextIndex)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, activeIndex, navigableItems, handleModelSelect])

  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) {
      setInternalIsOpen(nextOpen)
    }
    if (!nextOpen) {
      setShowAllModels(false)
      setSearchQuery('')
      setSelectedProviderId(null)
    }
    onOpenChange?.(nextOpen)
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

  const renderModelOption = (item: ModelListItem, index: number) => {
    const isSelected = modelString === item.key
    const isFavorite = favoriteKeySet.has(item.key)
    const isRecent = recentKeySet.has(item.key)
    const isActive = index === activeIndex

    return (
      <div
        key={item.key}
        data-model-index={index}
        data-active={isActive ? 'true' : undefined}
        onMouseMove={() => setActiveIndex(index)}
        className={`group flex w-full items-center gap-2 rounded-xl py-2 text-left transition-colors hover:bg-accent ${isSelected ? 'bg-highlight/10' : ''} ${isActive ? 'bg-accent ring-1 ring-border' : ''}`}
      >
        <button
          type="button"
          onClick={() => handleModelSelect(item.providerID, item.modelID)}
          className="min-w-0 flex-1 px-2 text-left"
        >
          <span className="block truncate text-sm font-medium text-foreground">
            {getPrimaryLabel(item)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
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
            className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Remove from recent"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            toggleFavorite({ providerID: item.providerID, modelID: item.modelID })
          }}
          className="rounded-full p-1.5 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={`h-4 w-4 ${isFavorite ? 'fill-warning text-warning' : ''}`} />
        </button>
        {isSelected && <Check className="h-5 w-5 shrink-0 pr-2 text-highlight" />}
      </div>
    )
  }

  const selectedModelItem = useMemo((): ModelListItem | null => {
    if (!model) return null
    const key = modelString ?? modelSelectionRef(model)
    const option = catalogOptions.find((candidate) => candidate.value === key)
    if (option) return toModelListItem(option)
    const providerName = providers.find((provider) => provider.id === model.providerID)?.name ?? model.providerID
    return {
      providerID: model.providerID,
      modelID: model.modelID,
      key,
      displayName: info?.name ?? model.modelID,
      providerName,
    }
  }, [model, modelString, info, providers, catalogOptions, toModelListItem])

  const renderProviderOption = (provider: ProviderListItem) => {
    return (
      <button
        key={provider.id}
        type="button"
        onClick={() => handleProviderSelect(provider.id)}
        className="flex w-full items-center gap-3 rounded-xl py-2.5 text-left transition-colors hover:bg-accent"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{provider.label}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{formatModelCount(provider.count)}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>
    )
  }

  const renderSidebarProviderOption = (provider: ProviderListItem) => {
    return (
      <button
        key={provider.id}
        type="button"
        onClick={() => handleProviderSelect(provider.id)}
        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
          selectedProviderId === provider.id
            ? 'bg-highlight/20 text-highlight font-medium'
            : 'text-muted-foreground hover:bg-accent'
        }`}
      >
        <div className="truncate">{provider.label}</div>
        <div className="text-xs text-muted-foreground">{formatModelCount(provider.count)}</div>
      </button>
    )
  }

  const renderVariantMenuItems = () => {
    if (!hasVariants) return null

    return (
      <>
        <DropdownMenuLabel>Variant</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => clearVariant()} className={!currentVariant ? 'text-highlight' : ''}>
          Default
          {!currentVariant && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
        {availableVariants.map(variant => (
          <DropdownMenuItem key={variant} onClick={() => setVariant(variant)} className={currentVariant === variant ? 'text-highlight' : ''}>
            <span className="capitalize">{variant}</span>
            {currentVariant === variant && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </>
    )
  }

  const selectedVariantLabel = currentVariant ? currentVariant : 'Default'

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
      {children && (
        <span className="contents" onClick={() => !disabled && handleOpenChange(true)}>
          {children}
        </span>
      )}
      <BottomSheet
        isOpen={isOpen}
        onClose={() => handleOpenChange(false)}
        heightClass="h-[70dvh] max-h-[720px]"
        className="z-[300] border-border bg-popover text-foreground shadow-2xl md:mx-auto md:max-w-lg"
        ariaLabel="Select model"
      >
        <div className={`flex items-center justify-between gap-2 px-4 ${showAllModels ? 'pb-2 pt-2' : 'pb-3 pt-0'}`}>
          {showAllModels ? (
            <>
              <button
                type="button"
                onClick={handleMoreModelsBack}
                className={`${ICON_BUTTON_CLASS} shrink-0`}
                aria-label="Back to quick models"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search models..."
                  className="h-9 border-border bg-muted pl-9 text-sm text-foreground placeholder:text-muted-foreground"
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
                className={ICON_BUTTON_CLASS}
                aria-label="Close model selector"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1 px-3 text-center">
                <h2 className="truncate text-base font-semibold tracking-tight">
                  {selectedModelLabel}
                  <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-highlight" />
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  {currentVariant ? `${selectedModelDescription} · ${currentVariant}` : selectedModelDescription}
                </p>
              </div>
              {hasVariants && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={!model && !hasVariants}
                      className="flex h-9 w-24 items-center justify-center gap-1 rounded-md border border-border bg-muted px-1.5 text-sm font-medium capitalize text-muted-foreground hover:bg-accent disabled:opacity-30"
                      aria-label={`Current variant: ${selectedVariantLabel}`}
                    >
                      <span className="truncate">{selectedVariantLabel}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
          isSearching ? (
            <div className="flex-1 overflow-hidden min-h-0">
              <VirtualizedList
                items={searchResults}
                itemHeight={MODEL_OPTION_ROW_HEIGHT}
                renderItem={(item, index) => renderModelOption(item, index)}
                getKey={(item) => item.key}
                emptyLabel="No models found"
                className="px-4 pb-4 pt-2"
                resetKey={`${selectedProviderId ?? 'all'}:${deferredSearchQuery}`}
                activeIndex={activeIndex}
              />
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden min-h-0">
              {/* Provider sidebar — desktop only */}
              <div className="hidden md:flex md:flex-col w-48 lg:w-56 border-r border-border overflow-y-auto flex-shrink-0">
                <div className="p-3 space-y-1">
                  {providerItems.map(renderSidebarProviderOption)}
                </div>
              </div>

              {/* Right panel */}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Desktop: model grid */}
                <div className="hidden md:block flex-1 overflow-hidden min-h-0">
                  <VirtualizedList
                    items={browseModels}
                    itemHeight={MODEL_OPTION_ROW_HEIGHT}
                    renderItem={(item, index) => renderModelOption(item, index)}
                    getKey={(item) => item.key}
                    emptyLabel="No models found"
                    className="px-4 pb-4 pt-2"
                    resetKey={selectedProviderId ?? 'all'}
                    activeIndex={activeIndex}
                  />
                </div>

                {/* Mobile: current single-column navigation */}
                <div className="md:hidden flex-1 overflow-hidden min-h-0">
                  {selectedProviderId ? (
                    <VirtualizedList
                      items={selectedProviderModels}
                      itemHeight={MODEL_OPTION_ROW_HEIGHT}
                      renderItem={(item, index) => renderModelOption(item, index)}
                      getKey={(item) => item.key}
                      emptyLabel="No models found"
                      className="px-4 pb-4"
                      resetKey={selectedProviderId}
                    />
                  ) : (
                    <div className="h-full overflow-y-auto px-4 pb-4">
                      <div className="space-y-1">
                        {providerItems.map(renderProviderOption)}
                      </div>
                      {providerItems.length === 0 && (
                        <div className="py-10 text-center text-sm text-muted-foreground">No providers found</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-safe pt-0">
            <div ref={quickListRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
              {quickSections.map(section => (
                <section key={section.title}>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    {section.icon ? <section.icon className="h-3.5 w-3.5" /> : null}
                    {section.title}
                  </h3>
                  <div className="space-y-1">
                    {section.models.map((item, index) => renderModelOption(item, (quickSectionOffsets.get(section.title) ?? 0) + index))}
                  </div>
                </section>
              ))}
            </div>
            <div className="flex-shrink-0 border-t border-border">
              <button
                type="button"
                onClick={() => setShowAllModels(true)}
                className="flex w-full items-center justify-between bg-card px-6 py-4 text-left text-sm font-semibold text-foreground transition-colors hover:bg-accent active:bg-card"
              >
                <span>More models</span>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  )
}
