import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { generateChangeWalkthrough, getChangeWalkthrough } from '@/api/changeWalkthroughs'
import { walkthroughSourceKey } from '@opencode-manager/shared/schemas'
import type { GenerateChangeWalkthroughRequest, WalkthroughSource } from '@opencode-manager/shared/schemas'

const GENERATING_POLL_INTERVAL_MS = 2_000

export function changeWalkthroughQueryKey(sessionId: string, sourceKey?: string) {
  return sourceKey === undefined
    ? (['change-walkthrough', sessionId] as const)
    : (['change-walkthrough', sessionId, sourceKey] as const)
}

export function useChangeWalkthrough(
  sessionId: string | undefined,
  enabled: boolean,
  source: WalkthroughSource,
) {
  const sourceKey = walkthroughSourceKey(source)
  return useQuery({
    queryKey: changeWalkthroughQueryKey(sessionId ?? '', sourceKey),
    queryFn: () => getChangeWalkthrough(sessionId!, source),
    enabled: enabled && !!sessionId,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.generating ? GENERATING_POLL_INTERVAL_MS : false),
  })
}

export function useGenerateChangeWalkthrough(sessionId: string | undefined, source: WalkthroughSource) {
  const queryClient = useQueryClient()
  const sourceKey = walkthroughSourceKey(source)

  return useMutation({
    mutationFn: async (request: GenerateChangeWalkthroughRequest) => {
      const targetSessionId = sessionId!
      const state = await generateChangeWalkthrough(targetSessionId, { ...request, source })
      return { sessionId: targetSessionId, sourceKey, state }
    },
    onSuccess: ({ sessionId: targetSessionId, sourceKey: targetSourceKey, state }) => {
      queryClient.setQueryData(changeWalkthroughQueryKey(targetSessionId, targetSourceKey), state)
    },
  })
}
