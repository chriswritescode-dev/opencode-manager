import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelOutput, generateOutput, getOutputData, getOutputHelperSessionIds, getOutputState, refineOutput } from '@/api/outputs'
import { listOutputDefinitions, promoteOutputDefinition } from '@/api/outputDefinitions'
import { outputParamsKey } from '@opencode-manager/shared/schemas'
import type {
  GenerateOutputRequest,
  OutputParams,
  OutputRecord,
  OutputState,
} from '@opencode-manager/shared/schemas'

const GENERATING_POLL_INTERVAL_MS = 2_000

export function outputsQueryKey(sessionId: string, definitionId?: string, paramsKey?: string) {
  if (definitionId === undefined) {
    return ['outputs', sessionId] as const
  }
  return paramsKey === undefined
    ? (['outputs', sessionId, definitionId] as const)
    : (['outputs', sessionId, definitionId, paramsKey] as const)
}

export const OUTPUT_DEFINITIONS_QUERY_ROOT = ['output-definitions'] as const

export function outputDefinitionsQueryKey(sessionId?: string) {
  return [...OUTPUT_DEFINITIONS_QUERY_ROOT, sessionId ?? 'global'] as const
}

export function useOutputHelperSessionIds(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: ['output-helper-sessions'],
    queryFn: getOutputHelperSessionIds,
    staleTime: 5 * 60_000,
    retry: false,
  })
  return useMemo(() => new Set(data ?? []), [data])
}

export function useOutputDefinitions(sessionId?: string) {
  return useQuery({
    queryKey: outputDefinitionsQueryKey(sessionId),
    queryFn: () => listOutputDefinitions(sessionId),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useOutputState(
  sessionId: string | undefined,
  definitionId: string | undefined,
  params: OutputParams,
  enabled = true,
) {
  const paramsKey = definitionId === undefined ? undefined : outputParamsKey(params)
  return useQuery({
    queryKey: outputsQueryKey(sessionId ?? '', definitionId, paramsKey),
    queryFn: () => getOutputState(sessionId!, definitionId!, params),
    enabled: enabled && !!sessionId && !!definitionId,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.generating || query.state.data?.running ? GENERATING_POLL_INTERVAL_MS : false,
  })
}

export function useGenerateOutput(
  sessionId: string | undefined,
  definitionId: string,
  params: OutputParams,
) {
  const queryClient = useQueryClient()
  const paramsKey = outputParamsKey(params)

  return useMutation({
    mutationFn: async (request: Omit<GenerateOutputRequest, 'definitionId' | 'params'>) => {
      const targetSessionId = sessionId!
      const state = await generateOutput(targetSessionId, { ...request, definitionId, params })
      return { sessionId: targetSessionId, definitionId, paramsKey, state }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        outputsQueryKey(result.sessionId, result.definitionId, result.paramsKey),
        result.state,
      )
      void queryClient.invalidateQueries({ queryKey: ['output-helper-sessions'] })
    },
  })
}

export function useRefineOutput(
  sessionId: string | undefined,
  definitionId: string,
  params: OutputParams,
) {
  const queryClient = useQueryClient()
  const paramsKey = outputParamsKey(params)

  return useMutation({
    mutationFn: async (text: string) => {
      const targetSessionId = sessionId!
      const state = await refineOutput(targetSessionId, { definitionId, params, text })
      return { sessionId: targetSessionId, definitionId, paramsKey, state }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        outputsQueryKey(result.sessionId, result.definitionId, result.paramsKey),
        result.state,
      )
    },
  })
}

export function useCancelOutput(
  sessionId: string | undefined,
  definitionId: string,
  params: OutputParams,
) {
  const queryClient = useQueryClient()
  const paramsKey = outputParamsKey(params)

  return useMutation({
    mutationFn: async () => {
      const targetSessionId = sessionId!
      await cancelOutput(targetSessionId, definitionId, params)
      return { sessionId: targetSessionId, definitionId, paramsKey }
    },
    onSuccess: ({ sessionId: targetSessionId, definitionId: targetDefinitionId, paramsKey: targetParamsKey }) => {
      const queryKey = outputsQueryKey(targetSessionId, targetDefinitionId, targetParamsKey)
      queryClient.setQueryData<OutputState>(queryKey, (cached) =>
        cached ? { ...cached, generating: false, running: false, error: null } : cached,
      )
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}

export function useOutputData(output: OutputRecord | null) {
  return useQuery({
    queryKey: ['output-data', output?.outputDir ?? null, output?.publishedAt ?? null],
    queryFn: () => getOutputData(output!.outputDir!),
    enabled: output?.outputDir != null && output?.publishedAt != null,
    retry: false,
    staleTime: Infinity,
  })
}

export function usePromoteOutputDefinition(sessionId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, replace }: { id: string; replace?: boolean }) => {
      const targetSessionId = sessionId!
      return promoteOutputDefinition({ sessionId: targetSessionId, id, replace })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: OUTPUT_DEFINITIONS_QUERY_ROOT })
    },
  })
}
