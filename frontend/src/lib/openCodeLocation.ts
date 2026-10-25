import { queryOptions } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { getOpenCodeLocation } from '@/api/opencode'
import { serverScopedKey } from '@/lib/serverScope'

/**
 * Query options for a repo directory's OpenCode project location, shared by the session picker and
 * the route-level prefetch so both read and write the same cache entry.
 */
export function openCodeLocationQueryOptions(
  fullPath: string,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
) {
  return queryOptions({
    queryKey: serverScopedKey(['opencode', 'location', fullPath], serverId),
    queryFn: () => getOpenCodeLocation(fullPath, serverId),
    staleTime: 5 * 60 * 1000,
  })
}
