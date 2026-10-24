import { useQuery } from '@tanstack/react-query'
import { getVcsInfo } from '@/api/opencode'
import { vcsInfoQueryKey } from '@/lib/queryInvalidation'
import { PERSISTED_CACHE_MAX_AGE_MS } from '@/lib/queryPersistence'

export interface UseVcsInfoOptions {
  enabled?: boolean
}

export function useVcsInfo(
  directory: string | undefined,
  serverId: string | undefined,
  options: UseVcsInfoOptions = {},
) {
  const { enabled = true } = options

  return useQuery({
    queryKey: vcsInfoQueryKey(directory, serverId),
    queryFn: () => getVcsInfo(directory ?? '', serverId),
    enabled: enabled && Boolean(directory),
    staleTime: 30_000,
    /** The key is only persisted when it ends in `info`, which a prefix default cannot express. */
    gcTime: PERSISTED_CACHE_MAX_AGE_MS,
    retry: false,
  })
}
