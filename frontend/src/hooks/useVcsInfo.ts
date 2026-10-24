import { useQuery } from '@tanstack/react-query'
import { getVcsInfo } from '@/api/opencode'
import { serverScopedKey } from '@/lib/serverScope'

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
    queryKey: [...serverScopedKey(['opencode', 'vcs', directory ?? ''], serverId), 'info'],
    queryFn: () => getVcsInfo(directory ?? '', serverId),
    enabled: enabled && Boolean(directory),
    retry: false,
  })
}
