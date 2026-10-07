import { useProviders } from '@/hooks/useProviders'
import type { ModelInfo } from '@opencode-manager/shared/opencode'

export function useScheduleModels(enabled: boolean, directory?: string) {
  const providersQuery = useProviders(directory, { enabled })
  const availableModels: ModelInfo[] | null =
    providersQuery.isSuccess && !providersQuery.isPlaceholderData
      ? providersQuery.data?.models ?? []
      : null

  return {
    availableModels,
    isLoading: providersQuery.isLoading,
  }
}
