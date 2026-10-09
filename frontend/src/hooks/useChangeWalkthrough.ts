import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { generateChangeWalkthrough, getChangeWalkthrough } from '@/api/changeWalkthroughs'
import { walkthroughHunksIdentity, walkthroughSourceKey } from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthrough,
  ChangeWalkthroughState,
  ChangeWalkthroughStateWire,
  ChangeWalkthroughWire,
  GenerateChangeWalkthroughRequest,
  WalkthroughSource,
} from '@opencode-manager/shared/schemas'

const GENERATING_POLL_INTERVAL_MS = 2_000

export function changeWalkthroughQueryKey(sessionId: string, sourceKey?: string) {
  return sourceKey === undefined
    ? (['change-walkthrough', sessionId] as const)
    : (['change-walkthrough', sessionId, sourceKey] as const)
}

function isCompleteWalkthrough(walkthrough: ChangeWalkthroughWire): walkthrough is ChangeWalkthrough {
  return walkthrough.hunks !== undefined
}

function mergeChangeWalkthroughState(
  state: ChangeWalkthroughStateWire,
  cached: ChangeWalkthrough | null,
): ChangeWalkthroughState {
  const incoming = state.walkthrough
  if (!incoming) {
    return { ...state, walkthrough: null }
  }
  if (isCompleteWalkthrough(incoming)) {
    return { ...state, walkthrough: incoming }
  }
  const hunks =
    cached && walkthroughHunksIdentity(cached) === walkthroughHunksIdentity(incoming)
      ? cached.hunks
      : []
  return { ...state, walkthrough: { ...incoming, hunks } }
}

export function useChangeWalkthrough(
  sessionId: string | undefined,
  enabled: boolean,
  source: WalkthroughSource,
) {
  const sourceKey = walkthroughSourceKey(source)
  const queryClient = useQueryClient()
  const queryKey = changeWalkthroughQueryKey(sessionId ?? '', sourceKey)
  return useQuery({
    queryKey,
    queryFn: async () => {
      const cached = queryClient.getQueryData<ChangeWalkthroughState>(queryKey)
      const cachedWalkthrough = cached?.walkthrough ?? null
      const hunksFor = cachedWalkthrough ? walkthroughHunksIdentity(cachedWalkthrough) : undefined
      const state =
        hunksFor === undefined
          ? await getChangeWalkthrough(sessionId!, source)
          : await getChangeWalkthrough(sessionId!, source, hunksFor)
      return mergeChangeWalkthroughState(state, cachedWalkthrough)
    },
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
