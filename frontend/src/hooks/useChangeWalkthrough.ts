import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import {
  cancelChangeWalkthrough,
  generateChangeWalkthrough,
  getChangeWalkthrough,
  getWalkthroughHelperSessionIds,
  refineChangeWalkthrough,
} from '@/api/changeWalkthroughs'
import { walkthroughSourceKey } from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthroughState,
  GenerateChangeWalkthroughRequest,
  WalkthroughSource,
} from '@opencode-manager/shared/schemas'

const GENERATING_POLL_INTERVAL_MS = 2_000

type ChangeWalkthroughMutationResult = {
  sessionId: string
  sourceKey: string
  state: ChangeWalkthroughState
}

function writeChangeWalkthroughToCache(
  queryClient: QueryClient,
  { sessionId, sourceKey, state }: ChangeWalkthroughMutationResult,
) {
  queryClient.setQueryData(changeWalkthroughQueryKey(sessionId, sourceKey), state)
}

export function changeWalkthroughQueryKey(sessionId: string, sourceKey?: string) {
  return sourceKey === undefined
    ? (['change-walkthrough', sessionId] as const)
    : (['change-walkthrough', sessionId, sourceKey] as const)
}

export function useWalkthroughHelperSessionIds(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: ['change-walkthrough-helper-sessions'],
    queryFn: getWalkthroughHelperSessionIds,
    staleTime: 5 * 60_000,
    retry: false,
  })
  return useMemo(() => new Set(data ?? []), [data])
}

export function useChangeWalkthrough(
  sessionId: string | undefined,
  enabled: boolean,
  source: WalkthroughSource,
) {
  const sourceKey = walkthroughSourceKey(source)
  const queryKey = changeWalkthroughQueryKey(sessionId ?? '', sourceKey)
  return useQuery({
    queryKey,
    queryFn: () => getChangeWalkthrough(sessionId!, source),
    enabled: enabled && !!sessionId,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.generating || query.state.data?.running ? GENERATING_POLL_INTERVAL_MS : false,
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
    onSuccess: (result) => {
      writeChangeWalkthroughToCache(queryClient, result)
      void queryClient.invalidateQueries({ queryKey: ['change-walkthrough-helper-sessions'] })
    },
  })
}

export function useRefineChangeWalkthrough(sessionId: string | undefined, source: WalkthroughSource) {
  const queryClient = useQueryClient()
  const sourceKey = walkthroughSourceKey(source)

  return useMutation({
    mutationFn: async (text: string) => {
      const targetSessionId = sessionId!
      const state = await refineChangeWalkthrough(targetSessionId, { source, text })
      return { sessionId: targetSessionId, sourceKey, state }
    },
    onSuccess: (result) => writeChangeWalkthroughToCache(queryClient, result),
  })
}

export function useCancelChangeWalkthrough(sessionId: string | undefined, source: WalkthroughSource) {
  const queryClient = useQueryClient()
  const sourceKey = walkthroughSourceKey(source)

  return useMutation({
    mutationFn: async () => {
      const targetSessionId = sessionId!
      await cancelChangeWalkthrough(targetSessionId, source)
      return { sessionId: targetSessionId, sourceKey }
    },
    onSuccess: ({ sessionId: targetSessionId, sourceKey: targetSourceKey }) => {
      const queryKey = changeWalkthroughQueryKey(targetSessionId, targetSourceKey)
      queryClient.setQueryData<ChangeWalkthroughState>(queryKey, (cached) =>
        cached ? { ...cached, generating: false, running: false, error: null } : cached,
      )
      queryClient.invalidateQueries({ queryKey })
    },
  })
}
