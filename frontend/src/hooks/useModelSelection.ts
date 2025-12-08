import { useEffect } from 'react'
import { useConfig } from './useOpenCode'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'

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
  const { model, recentModels, setModel, initializeFromConfig, getModelString } = useModelStore()

  useEffect(() => {
    if (config?.model) {
      initializeFromConfig(config.model)
    }
  }, [config?.model, initializeFromConfig])

  return {
    model,
    modelString: getModelString(),
    recentModels,
    setModel,
  }
}
