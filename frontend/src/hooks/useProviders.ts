import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getProviders } from '@/api/providers'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { serverScopedKey } from '@/lib/serverScope'

interface UseProvidersOptions {
  enabled?: boolean
}

export function useProviders(directory?: string, options: UseProvidersOptions = {}) {
  const serverId = useOpenCodeServerId()

  return useQuery({
    queryKey: serverScopedKey(['opencode', 'providers', directory], serverId),
    queryFn: () => getProviders(directory, serverId),
    enabled: options.enabled ?? true,
    staleTime: 30000,
    placeholderData: keepPreviousData,
  })
}
