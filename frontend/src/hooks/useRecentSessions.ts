import { useQuery } from '@tanstack/react-query'
import { getRecentSessions, type RecentSession } from '@/api/sessions'

export function useRecentSessions(hours: number = 8) {
  return useQuery({
    queryKey: ['sessions', 'recent', hours],
    queryFn: () => getRecentSessions(hours),
    refetchInterval: 30000,
    staleTime: 10000,
  })
}

export type { RecentSession }
