import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { generateChangeWalkthrough, getChangeWalkthrough } from '@/api/changeWalkthroughs'
import type { GenerateChangeWalkthroughRequest } from '@opencode-manager/shared/schemas'

const GENERATING_POLL_INTERVAL_MS = 2_000

export function changeWalkthroughQueryKey(sessionId: string) {
  return ['change-walkthrough', sessionId] as const
}

export function useChangeWalkthrough(sessionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: changeWalkthroughQueryKey(sessionId ?? ''),
    queryFn: () => getChangeWalkthrough(sessionId!),
    enabled: enabled && !!sessionId,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.generating ? GENERATING_POLL_INTERVAL_MS : false),
  })
}

export function useGenerateChangeWalkthrough(sessionId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: GenerateChangeWalkthroughRequest) => {
      const targetSessionId = sessionId!
      const state = await generateChangeWalkthrough(targetSessionId, request)
      return { sessionId: targetSessionId, state }
    },
    onSuccess: ({ sessionId: targetSessionId, state }) => {
      queryClient.setQueryData(changeWalkthroughQueryKey(targetSessionId), state)
    },
  })
}
