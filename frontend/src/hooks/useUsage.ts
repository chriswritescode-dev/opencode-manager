import { useQueries, useQuery } from '@tanstack/react-query'
import { getSessionStats, loadSessionUsageMessages } from '@/api/usage'
import { serverScopedKey } from '@/lib/serverScope'
import { resolveUsageRange, type UsageRangeSelection } from '@/lib/usageRange'

export function usageStatsQueryKey(
  selection: UsageRangeSelection,
  timezone: string,
  serverId: string,
) {
  return serverScopedKey(['opencode', 'usage', 'stats', selection, timezone], serverId)
}

export function sessionUsageQueryKey(sessionID: string, serverId: string) {
  return serverScopedKey(['opencode', 'session-usage', sessionID], serverId)
}

export function useUsageStats(selection: UsageRangeSelection, serverId: string) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return useQuery({
    queryKey: usageStatsQueryKey(selection, timezone, serverId),
    queryFn: () => {
      const range = resolveUsageRange(selection, Date.now())
      if (range === null) return Promise.reject(new Error('Usage range is incomplete'))
      return getSessionStats({ ...range, timezone, tools: 'detail' }, serverId)
    },
    enabled: resolveUsageRange(selection, Date.now()) !== null,
    staleTime: 60_000,
    retry: false,
  })
}

function buildSessionUsageQueryOptions(sessionID: string | undefined, serverId: string) {
  return {
    queryKey: sessionUsageQueryKey(sessionID ?? '', serverId),
    queryFn: () => {
      if (sessionID === undefined) return Promise.reject(new Error('Session usage needs a session id'))
      return loadSessionUsageMessages(sessionID, serverId)
    },
    enabled: sessionID !== undefined,
    staleTime: 30_000,
    retry: false,
  }
}

export function useSessionUsage(sessionID: string | undefined, serverId: string) {
  return useQuery(buildSessionUsageQueryOptions(sessionID, serverId))
}

export function useSessionUsageQueries(sessionIDs: readonly string[], serverId: string) {
  return useQueries({
    queries: sessionIDs.map((sessionID) => buildSessionUsageQueryOptions(sessionID, serverId)),
  })
}
