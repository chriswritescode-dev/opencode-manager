import { useMemo } from 'react'
import { useModelSelection } from './useModelSelection'
import { useModelStore } from '@/stores/modelStore'
import { useOpenCodeClient } from './useOpenCode'
import { getProviders } from '@/api/providers'
import { useQuery } from '@tanstack/react-query'

export interface UseVariantsResult {
  availableVariants: string[]
  currentVariant: string | undefined
  setVariant: (variant: string | undefined) => void
  cycleVariant: () => void
  clearVariant: () => void
  hasVariants: boolean
}

export function useVariants(
  opcodeUrl: string | null | undefined,
  directory?: string
): UseVariantsResult {
  const { model } = useModelSelection(opcodeUrl, directory)
  const { setVariant: setStoreVariant, clearVariant: clearStoreVariant } = useModelStore()
  const client = useOpenCodeClient(opcodeUrl, directory)

   const { data: providersData, isLoading } = useQuery({
     queryKey: ['opencode', 'providers', opcodeUrl, directory],
     queryFn: () => getProviders(directory),
     enabled: !!client && !!model,
     staleTime: 30000,
   })

   const currentModel = useMemo(() => {
     if (!model || isLoading || !providersData?.providers || providersData.providers.length === 0) return null
     for (const provider of providersData.providers) {
      if (provider.id === model.providerID && provider.models) {
        const modelData = provider.models[model.modelID]
        if (modelData) {
          return modelData
        }
      }
    }
    return null
  }, [model, providersData, isLoading])

  const availableVariants = useMemo(() => {
    if (!currentModel?.variants) return []
    return Object.keys(currentModel.variants)
  }, [currentModel])

  const currentVariant = useModelStore((state) =>
    model ? state.variants[`${model.providerID}/${model.modelID}`] : undefined
  )

  const setVariant = useMemo(
    () => (variant: string | undefined) => {
      if (!model) return
      setStoreVariant(model, variant)
    },
    [model, setStoreVariant],
  )

  const cycleVariant = useMemo(() => {
    return () => {
      if (!model || availableVariants.length === 0) return

      if (!currentVariant) {
        setStoreVariant(model, availableVariants[0])
      } else {
        const currentIndex = availableVariants.indexOf(currentVariant)
        if (currentIndex === availableVariants.length - 1) {
          clearStoreVariant(model)
        } else {
          setStoreVariant(model, availableVariants[currentIndex + 1])
        }
      }
    }
  }, [model, availableVariants, currentVariant, setStoreVariant, clearStoreVariant])

  const clearVariant = useMemo(
    () => () => {
      if (!model) return
      clearStoreVariant(model)
    },
    [model, clearStoreVariant],
  )

  return {
    availableVariants,
    currentVariant,
    setVariant,
    cycleVariant,
    clearVariant,
    hasVariants: availableVariants.length > 0,
  }
}
