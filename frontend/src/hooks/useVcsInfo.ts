import { useQuery } from '@tanstack/react-query'
import { getVcsInfo } from '@/api/opencode'
import { serverScopedKey } from '@/lib/serverScope'

export interface UseVcsInfoOptions {
  enabled?: boolean
}

/**
 * Reads the version-control info of a directory through the OpenCode server in
 * scope. The query is keyed by directory and server id, so the session header,
 * the project header and the source control panel share one cached read, and a
 * linked server reports its own checkout rather than the Manager's.
 *
 * @param directory Absolute checkout directory; the query stays disabled without one.
 * @param serverId Linked server to read from, or the local Manager when omitted.
 * @param options.enabled Whether to read the info; defaults to `true`.
 */
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
    staleTime: 60_000,
  })
}
