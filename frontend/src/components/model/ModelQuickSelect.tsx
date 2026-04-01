import { useMemo } from 'react'
import { Check, ChevronRight, Clock, Sparkles } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelSelection } from '@/hooks/useModelSelection'
import { useVariants } from '@/hooks/useVariants'
import { formatModelName, getProviders } from '@/api/providers'
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
  const { modelString, recentModels, setModel } = useModelSelection(opcodeUrl, directory)
  const { availableVariants, currentVariant, setVariant, clearVariant, hasVariants } = useVariants(opcodeUrl, directory)
  const client = useOpenCodeClient(opcodeUrl, directory)

   const { data: providersData } = useQuery({
     queryKey: ['opencode', 'providers', opcodeUrl, directory],
     queryFn: () => getProviders(),
     enabled: !!client,
     staleTime: 30000,
   })

   const recentModelsWithNames = useMemo(() => {
     if (!providersData?.providers || providersData.providers.length === 0 || recentModels.length === 0) return []
     
     return recentModels
       .filter(recent => {
         const key = `${recent.providerID}/${recent.modelID}`
         return key !== modelString
       })
       .slice(0, 5)
       .map(recent => {
         let displayName = recent.modelID
         for (const provider of providersData.providers) {
          if (provider.id === recent.providerID && provider.models) {
            const modelData = provider.models[recent.modelID]
            if (modelData) {
              displayName = formatModelName(modelData)
              break
            }
          }
        }
        return {
          ...recent,
          displayName,
          key: `${recent.providerID}/${recent.modelID}`,
        }
      })
  }, [recentModels, providersData, modelString])

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

  const hasRecents = recentModelsWithNames.length > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {hasVariants && (
          <>
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Thinking Effort
            </DropdownMenuLabel>
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
                <span className="text-center capitalize text-warning">{variant}</span>
                {currentVariant === variant && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
            {hasRecents && <DropdownMenuSeparator />}
          </>
        )}

        {hasRecents && (
          <>
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Recent Models
            </DropdownMenuLabel>
            {recentModelsWithNames.map((recent) => (
              <DropdownMenuItem
                key={recent.key}
                onClick={() => handleModelSelect(recent.providerID, recent.modelID)}
                className="flex items-center justify-between"
              >
                <span className="truncate">{recent.displayName}</span>
                {modelString === recent.key && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
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
