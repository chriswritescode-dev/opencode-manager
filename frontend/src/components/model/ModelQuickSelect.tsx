import { useCallback, useMemo } from 'react'
import { Check, ChevronRight, Star } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useVariants } from '@/hooks/useVariants'
import { formatModelName, formatProviderName, getProviders } from '@/api/providers'
import { useQuery } from '@tanstack/react-query'
import { useOpenCodeClient } from '@/hooks/useOpenCode'

interface ModelQuickSelectProps {
  opcodeUrl: string | null | undefined
  directory?: string
  onOpenFullDialog: () => void
  disabled?: boolean
  children: React.ReactNode
}

export function ModelQuickSelect({
  opcodeUrl,
  directory,
  onOpenFullDialog,
  disabled,
  children,
}: ModelQuickSelectProps) {
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

    const favoriteModelsWithNames = useMemo(() => {
      return favoriteModels
        .filter(favorite => `${favorite.providerID}/${favorite.modelID}` !== modelString)
        .slice(0, 5)
        .map(favorite => ({
           ...favorite,
           displayName: getDisplayName(favorite.providerID, favorite.modelID),
           providerName: getProviderName(favorite.providerID),
           key: `${favorite.providerID}/${favorite.modelID}`,
         }))
    }, [favoriteModels, getDisplayName, getProviderName, modelString])

    const recentModelsWithNames = useMemo(() => {
      return recentModels
        .filter(recent => {
          const key = `${recent.providerID}/${recent.modelID}`
          return key !== modelString && !favoriteModels.some(favorite => favorite.providerID === recent.providerID && favorite.modelID === recent.modelID)
        })
        .slice(0, 5)
        .map(recent => ({
           ...recent,
           displayName: getDisplayName(recent.providerID, recent.modelID),
           providerName: getProviderName(recent.providerID),
           key: `${recent.providerID}/${recent.modelID}`,
         }))
    }, [recentModels, favoriteModels, getDisplayName, getProviderName, modelString])

  const duplicateDisplayNames = useMemo(() => {
    const counts = [...favoriteModelsWithNames, ...recentModelsWithNames].reduce<Record<string, number>>((acc, item) => {
      acc[item.displayName] = (acc[item.displayName] || 0) + 1
      return acc
    }, {})

    return new Set(Object.entries(counts).filter(([, count]) => count > 1).map(([name]) => name))
  }, [favoriteModelsWithNames, recentModelsWithNames])

  const duplicateModelIds = useMemo(() => {
    const counts = [...favoriteModelsWithNames, ...recentModelsWithNames].reduce<Record<string, number>>((acc, item) => {
      acc[item.modelID] = (acc[item.modelID] || 0) + 1
      return acc
    }, {})

    return new Set(Object.entries(counts).filter(([, count]) => count > 1).map(([id]) => id))
  }, [favoriteModelsWithNames, recentModelsWithNames])

  const handleVariantSelect = (variant: string | undefined) => {
    if (variant === undefined) {
      clearVariant()
    } else {
      setVariant(variant)
    }
  }

  const handleModelSelect = (providerID: string, modelID: string) => {
    setModel({ providerID, modelID })
  }

  const handleCurrentFavoriteToggle = () => {
    if (!model) return
    toggleFavorite(model)
  }

  const currentModelDisplayName = model ? getDisplayName(model.providerID, model.modelID) : ''
  const currentProviderName = model ? getProviderName(model.providerID) : ''
  const isCurrentFavorite = model
    ? favoriteModels.some((favorite) => favorite.providerID === model.providerID && favorite.modelID === model.modelID)
    : false
  const hasFavorites = favoriteModelsWithNames.length > 0
  const hasRecents = recentModelsWithNames.length > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {model && (
          <>
            <DropdownMenuItem className="flex items-center justify-between font-medium">
              <span className="truncate text-orange-500">
                {duplicateModelIds.has(model.modelID) || duplicateDisplayNames.has(currentModelDisplayName)
                  ? `${currentProviderName}/${currentModelDisplayName}`
                  : currentModelDisplayName}
              </span>
              <Check className="h-4 w-4 text-orange-500" />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleCurrentFavoriteToggle}
              className="flex items-center justify-between"
            >
              <span>{isCurrentFavorite ? 'Remove from favorites' : 'Add to favorites'}</span>
              <Star className={`h-4 w-4 ${isCurrentFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {hasVariants && (
          <>
            <DropdownMenuItem
              onClick={() => handleVariantSelect(undefined)}
              className="flex items-center justify-between"
            >
              <span>Default</span>
              {!currentVariant && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
            {availableVariants.map((variant) => (
              <DropdownMenuItem
                key={variant}
                onClick={() => handleVariantSelect(variant)}
                className="flex items-center justify-between"
              >
                <span className="capitalize text-orange-500 text-center">{variant}</span>
                {currentVariant === variant && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {hasFavorites && (
          <>
            {favoriteModelsWithNames.map((favorite) => (
              <DropdownMenuItem
                key={favorite.key}
                onClick={() => handleModelSelect(favorite.providerID, favorite.modelID)}
                className="flex items-center justify-between"
              >
                <span className="truncate">
                  {duplicateModelIds.has(favorite.modelID) || duplicateDisplayNames.has(favorite.displayName)
                    ? `${favorite.providerName}/${favorite.displayName}`
                    : favorite.displayName}
                </span>
                {modelString === favorite.key && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {hasRecents && (
          <>
            {recentModelsWithNames.map((recent) => (
              <DropdownMenuItem
                key={recent.key}
                onClick={() => handleModelSelect(recent.providerID, recent.modelID)}
                className="flex items-center justify-between"
              >
                <span className="truncate">
                  {duplicateModelIds.has(recent.modelID) || duplicateDisplayNames.has(recent.displayName)
                    ? `${recent.providerName}/${recent.displayName}`
                    : recent.displayName}
                </span>
                {modelString === recent.key && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuItem
          onClick={onOpenFullDialog}
          className="flex items-center justify-between"
        >
          <span>All Models...</span>
          <ChevronRight className="h-4 w-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
