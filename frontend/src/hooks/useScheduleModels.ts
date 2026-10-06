import { useMemo } from 'react'
import { useProvidersWithModels } from '@/hooks/useProvidersWithModels'
import { useOpenCodeConfigModel, useOpenCodeModelState } from '@/hooks/useModelSelection'
import { buildAvailableModelKeys } from '@/lib/schedules/schedule-model'

export function useScheduleModels(enabled: boolean, directory?: string) {
  const providersQuery = useProvidersWithModels({
    enabled,
    directory,
    keyParts: ['schedule-models'],
  })
  const { data: modelState } = useOpenCodeModelState(directory, enabled)
  const { data: configDefaultModel = null, isLoading: configLoading } = useOpenCodeConfigModel(directory, enabled)
  const providerModels = providersQuery.data
  const availableModelKeys = useMemo(
    () => (providersQuery.isSuccess ? buildAvailableModelKeys(providerModels) : null),
    [providersQuery.isSuccess, providerModels],
  )

  return {
    providerModels,
    modelState,
    availableModelKeys,
    configDefaultModel,
    isLoading: providersQuery.isLoading || configLoading,
  }
}
