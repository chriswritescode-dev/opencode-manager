import { useQuery } from '@tanstack/react-query'
import { getVcsInfo } from '@/api/opencode'
import { vcsInfoQueryKey } from '@/lib/queryInvalidation'

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
    retry: false,
  })
}
