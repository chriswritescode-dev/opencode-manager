import { useMemo, useRef } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { findModelInfo } from '@opencode-manager/shared/opencode'
import type { ModelInfo, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { useProviders } from '@/hooks/useProviders'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { serverScopedKey } from '@/lib/serverScope'
import type { TranscriptCache } from '@/lib/session-projection'
import type { ContextUsage } from '@/lib/contextUsage'

function lastCompletedCompactionIndex(messages: SessionMessageInfo[], end: number): number {
  for (let index = end - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === 'compaction' && message.status === 'completed') return index
  }
  return -1
}

function lastAssistantWithUsageIndex(messages: SessionMessageInfo[], start: number, end: number): number {
  for (let index = end - 1; index > start; index -= 1) {
    const message = messages[index]
    if (message?.type === 'assistant' && message.tokens !== undefined) return index
  }
  return -1
}

function computeContextUsage(
  messages: SessionMessageInfo[],
  models: ModelInfo[] | undefined,
  revertMessageID: string | undefined,
): ContextUsage | null {
  const boundaryIndex = revertMessageID
    ? messages.findIndex((message) => message.id === revertMessageID)
    : -1
  if (revertMessageID && boundaryIndex === -1) {
    return null
  }

  const end = boundaryIndex === -1 ? messages.length : boundaryIndex
  const compactionIndex = lastCompletedCompactionIndex(messages, end)
  const assistantIndex = lastAssistantWithUsageIndex(messages, compactionIndex, end)
  const assistant = assistantIndex === -1 ? undefined : messages[assistantIndex]
  if (assistant?.type !== 'assistant' || assistant.tokens === undefined) {
    return null
  }

  const { input, output, reasoning, cache } = assistant.tokens
  const totalTokens = input + output + reasoning + cache.read + cache.write
  if (totalTokens <= 0) {
    return null
  }

  const model = models
    ? findModelInfo(models, { providerID: assistant.model.providerID, modelID: assistant.model.id })
    : undefined
  const contextLimit = model?.limit.context ?? null
  const usagePercentage = contextLimit ? Math.round((totalTokens / contextLimit) * 100) : null

  return { totalTokens, usagePercentage, contextLimit }
}

function hasSameUsage(left: ContextUsage | null, right: ContextUsage | null): boolean {
  if (left === null || right === null) return left === right

  return left.totalTokens === right.totalTokens
    && left.usagePercentage === right.usagePercentage
    && left.contextLimit === right.contextLimit
}

/**
 * Latest assistant context usage for a session.
 *
 * The transcript cache is rewritten on every streaming flush, so the returned object keeps its
 * identity while the measured totals are unchanged. That lets consumers memoize on the reference
 * instead of re-rendering for each frame of a reply.
 */
export const useContextUsage = (
  sessionID: string | undefined,
  directory?: string,
  revertMessageID?: string,
): ContextUsage | null => {
  const serverId = useOpenCodeServerId()
  const transcriptQuery = useQuery<TranscriptCache>({
    queryKey: serverScopedKey(sessionTranscriptQueryKey(sessionID ?? ''), serverId),
    queryFn: skipToken,
  })
  const transcriptData = transcriptQuery.data

  const { data: providersData } = useProviders(directory)
  const models = providersData?.models

  const lastUsageRef = useRef<ContextUsage | null>(null)

  return useMemo(() => {
    const computed = computeContextUsage(
      transcriptData?.transcript.messages ?? [],
      models,
      revertMessageID,
    )
    const usage = hasSameUsage(lastUsageRef.current, computed) ? lastUsageRef.current : computed
    lastUsageRef.current = usage
    return usage
  }, [transcriptData, models, revertMessageID])
}
