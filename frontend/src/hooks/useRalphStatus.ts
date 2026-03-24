import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRalphStatus, cancelRalphLoop } from '@/api/memory'
import { showToast } from '@/lib/toast'

export function useRalphStatus(repoId: number | undefined, open: boolean) {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['ralph-status', repoId],
    queryFn: () => getRalphStatus(repoId!),
    enabled: open && !!repoId,
    staleTime: 0,
    refetchInterval: ({ state }) => {
      const loops = state.data?.loops ?? []
      return loops.some(l => l.active) ? 5000 : false
    },
  })

  const cancelMutation = useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) =>
      cancelRalphLoop(repoId!, sessionId),
    onSuccess: (result) => {
      if (result.cancelled) {
        queryClient.invalidateQueries({ queryKey: ['ralph-status', repoId] })
      } else {
        showToast.error('Ralph loop is no longer active')
      }
    },
    onError: () => {
      showToast.error('Unable to cancel the Ralph loop. Please try again.')
    },
  })

  const pendingSessionId = cancelMutation.isPending ? (cancelMutation.variables?.sessionId ?? null) : null

  return { data, isLoading, error, cancelMutation, pendingSessionId }
}

export function useRalphActiveCount(repoId: number | undefined, enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['ralph-status', repoId],
    queryFn: () => getRalphStatus(repoId!),
    enabled: enabled && !!repoId,
    staleTime: 0,
    refetchInterval: 10000,
  })
  return data?.loops.filter(l => l.active).length ?? 0
}
