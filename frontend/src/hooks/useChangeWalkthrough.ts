import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { generateChangeWalkthrough, getChangeWalkthrough } from '@/api/changeWalkthroughs'
import type { GenerateChangeWalkthroughRequest } from '@opencode-manager/shared/schemas'

export function changeWalkthroughQueryKey(sessionId: string) {
  return ['change-walkthrough', sessionId] as const
}

export function useChangeWalkthrough(sessionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: changeWalkthroughQueryKey(sessionId ?? ''),
    queryFn: () => getChangeWalkthrough(sessionId!),
    enabled: enabled && !!sessionId,
    staleTime: 30_000,
  })
}

export function useGenerateChangeWalkthrough(sessionId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: GenerateChangeWalkthroughRequest) =>
      generateChangeWalkthrough(sessionId!, request),
    onSuccess: (walkthrough) => {
      queryClient.setQueryData(changeWalkthroughQueryKey(walkthrough.sessionId), {
        walkthrough,
        currentDiffHash: walkthrough.diffHash,
        stale: false,
      })
      queryClient.invalidateQueries({ queryKey: changeWalkthroughQueryKey(walkthrough.sessionId) })
    },
  })
}
