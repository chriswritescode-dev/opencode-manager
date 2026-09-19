import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getProvidersWithModels } from '@/api/providers'
import { useOpenCodeConfigFile } from '@/hooks/useOpenCodeConfigFile'

interface UseProvidersWithModelsOptions {
  enabled: boolean
  directory?: string
  keyParts?: readonly unknown[]
}

export function useProvidersWithModels({ enabled, directory, keyParts }: UseProvidersWithModelsOptions) {
  const { data: config, isLoading: isConfigLoading } = useOpenCodeConfigFile(enabled)

  const query = useQuery({
    queryKey: ['providers-with-models', ...(keyParts ?? [])],
    queryFn: () => getProvidersWithModels(directory, config),
    enabled: enabled && !isConfigLoading,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  return { ...query, data: query.data ?? [] }
}
