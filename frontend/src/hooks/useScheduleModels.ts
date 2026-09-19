import { useMemo } from 'react'
import { useProvidersWithModels } from '@/hooks/useProvidersWithModels'
import { useOpenCodeConfigFile } from '@/hooks/useOpenCodeConfigFile'
import { buildAvailableModelKeys, getConfigDefaultModel } from '@/lib/schedules/schedule-model'

export function useScheduleModels(enabled: boolean) {
  const providersQuery = useProvidersWithModels({
    enabled,
    keyParts: ['schedule-models'],
  })
  const { data: configFile, isLoading: configLoading } = useOpenCodeConfigFile(enabled)
  const providerModels = providersQuery.data
  const availableModelKeys = useMemo(
    () => (providersQuery.isSuccess ? buildAvailableModelKeys(providerModels) : null),
    [providersQuery.isSuccess, providerModels],
  )
  const configDefaultModel = useMemo(() => getConfigDefaultModel(configFile), [configFile])

  return {
    providerModels,
    availableModelKeys,
    configDefaultModel,
    isLoading: providersQuery.isLoading || configLoading,
  }
}
