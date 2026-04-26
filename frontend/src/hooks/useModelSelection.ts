import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useConfig } from './useOpenCode'
import { useOpenCodeClient } from './useOpenCode'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import { addOpenCodeRecentModel, getOpenCodeModelState, getProviders } from '@/api/providers'

interface UseModelSelectionResult {
  model: ModelSelection | null
  modelString: string | null
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
  setModel: (model: ModelSelection) => void
  isModelStateLoading: boolean
}

const modelStateQueryKey = ['opencode', 'model-state']

export function useModelSelection(
  opcodeUrl: string | null | undefined,
  directory?: string
): UseModelSelectionResult {
  const { data: config } = useConfig(opcodeUrl, directory)
  const client = useOpenCodeClient(opcodeUrl, directory)
  const queryClient = useQueryClient()
  
  const { data: providersData } = useQuery({
    queryKey: ['opencode', 'providers', opcodeUrl, directory],
    queryFn: () => getProviders(),
    enabled: !!client,
    staleTime: 30000,
  })

  const { 
    model, 
    recentModels, 
    favoriteModels,
    setModel: setStoreModel,
    syncModelState,
    validateAndSyncModel, 
    getModelString 
  } = useModelStore()

  const { data: modelState, isLoading: isModelStateLoading } = useQuery({
    queryKey: [...modelStateQueryKey, opcodeUrl, directory],
    queryFn: () => getOpenCodeModelState(),
    enabled: !!client,
    staleTime: 30000,
    placeholderData: keepPreviousData,
  })

  const updateRecentModel = useMutation({
    mutationFn: addOpenCodeRecentModel,
    onSuccess: (state) => {
      syncModelState(state)
      queryClient.setQueryData([...modelStateQueryKey, opcodeUrl, directory], state)
      queryClient.invalidateQueries({ queryKey: [...modelStateQueryKey, opcodeUrl, directory] })
    },
  })

  const defaultModelString = providersData?.providers
    .map((provider) => {
      const modelID = providersData.default[provider.id] || Object.keys(provider.models || {})[0]
      return modelID ? `${provider.id}/${modelID}` : null
    })
    .find((value): value is string => Boolean(value))

  useEffect(() => {
    validateAndSyncModel(config?.model || defaultModelString, providersData?.providers)
  }, [config?.model, defaultModelString, providersData, validateAndSyncModel])

  useEffect(() => {
    if (modelState) {
      syncModelState(modelState)
    }
  }, [modelState, syncModelState])

  const setModel = (nextModel: ModelSelection) => {
    setStoreModel(nextModel)
    updateRecentModel.mutate(nextModel)
  }

  return {
    model,
    modelString: getModelString(),
    recentModels,
    favoriteModels,
    setModel,
    isModelStateLoading,
  }
}
