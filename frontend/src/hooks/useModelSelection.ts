import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConfig } from './useOpenCode'
import { useOpenCodeClient } from './useOpenCode'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import { getProviders } from '@/api/providers'

interface UseModelSelectionResult {
  model: ModelSelection | null
  modelString: string | null
  recentModels: ModelSelection[]
  setModel: (model: ModelSelection) => void
}

export function useModelSelection(
  opcodeUrl: string | null | undefined,
  directory?: string
): UseModelSelectionResult {
  const { data: config } = useConfig(opcodeUrl, directory)
  const client = useOpenCodeClient(opcodeUrl, directory)
  
  const { data: providersData } = useQuery({
    queryKey: ['opencode', 'providers', opcodeUrl, directory],
    queryFn: () => getProviders(),
    enabled: !!client,
    staleTime: 30000,
  })

  const { 
    model, 
    recentModels, 
    setModel, 
    validateAndSyncModel, 
    getModelString 
  } = useModelStore()

  useEffect(() => {
    validateAndSyncModel(config?.model, providersData?.providers)
  }, [config?.model, providersData, validateAndSyncModel])

  return {
    model,
    modelString: getModelString(),
    recentModels,
    setModel,
  }
}
