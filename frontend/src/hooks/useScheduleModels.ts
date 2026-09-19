import { useMemo } from 'react'
import { useProvidersWithModels } from '@/hooks/useProvidersWithModels'
import { useOpenCodeConfigFile } from '@/hooks/useOpenCodeConfigFile'
import { buildAvailableModelKeys, getConfigDefaultModel } from '@/lib/schedules/schedule-model'

export function useScheduleModels(enabled: boolean) {
  const { data: providerModels, isLoading: providersLoading } = useProvidersWithModels({
    enabled,
    keyParts: ['schedule-models'],
  })
  const { data: configFile, isLoading: configLoading } = useOpenCodeConfigFile(enabled)
  const availableModelKeys = useMemo(() => buildAvailableModelKeys(providerModels), [providerModels])
  const configDefaultModel = useMemo(() => getConfigDefaultModel(configFile), [configFile])

  return {
    providerModels,
    availableModelKeys,
    configDefaultModel,
    isLoading: providersLoading || configLoading,
  }
}
