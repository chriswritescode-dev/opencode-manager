import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSessionSummaries, summarizeSession } from '@/api/repos'

export function useSessionSummaries(repoId: number | undefined) {
  return useQuery({
    queryKey: ['session-summaries', repoId],
    queryFn: () => getSessionSummaries(repoId!),
    enabled: !!repoId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useSummarizeSession(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: string) => summarizeSession(repoId!, sessionId),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ['session-summaries', repoId],
        (old: { summaries: Record<string, string | null>; sessionCount: number } | undefined) => {
          if (!old) return old
          return {
            ...old,
            summaries: {
              ...old.summaries,
              [data.sessionId]: data.summary,
            },
          }
        }
      )
    },
  })
}
