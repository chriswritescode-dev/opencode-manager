import { useQuery } from '@tanstack/react-query'
import { getProviders } from '@/api/providers'

interface UseProvidersOptions {
  enabled?: boolean
}

export function useProviders(directory?: string, options: UseProvidersOptions = {}) {
  return useQuery({
    queryKey: ['opencode', 'providers', directory],
    queryFn: () => getProviders(directory),
    enabled: options.enabled ?? true,
    staleTime: 30000,
  })
}
