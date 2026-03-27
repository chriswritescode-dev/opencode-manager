import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLoopStatus, cancelLoop } from '@/api/memory'
import { showToast } from '@/lib/toast'

export function useLoopStatus(repoId: number | undefined, open: boolean) {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['memory-loop-status', repoId],
    queryFn: () => getLoopStatus(repoId!),
    enabled: open && !!repoId,
    staleTime: 0,
    refetchInterval: ({ state }) => {
      const loops = state.data?.loops ?? []
      return loops.some(l => l.active) ? 5000 : false
    },
  })

  const cancelMutation = useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) =>
      cancelLoop(repoId!, sessionId),
    onSuccess: (result) => {
      if (result.cancelled) {
        queryClient.invalidateQueries({ queryKey: ['memory-loop-status', repoId] })
      } else {
        showToast.error('Memory loop is no longer active')
      }
    },
    onError: () => {
      showToast.error('Unable to cancel the memory loop. Please try again.')
    },
  })

  const pendingSessionId = cancelMutation.isPending ? (cancelMutation.variables?.sessionId ?? null) : null

  return { data, isLoading, error, cancelMutation, pendingSessionId }
}

export function useLoopActiveCount(repoId: number | undefined, enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['memory-loop-status', repoId],
    queryFn: () => getLoopStatus(repoId!),
    enabled: enabled && !!repoId,
    staleTime: 0,
    refetchInterval: 10000,
  })
  return data?.loops.filter(l => l.active).length ?? 0
}
