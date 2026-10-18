import { useMemo } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { findModelInfo } from '@opencode-manager/shared/opencode'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { useProviders } from '@/hooks/useProviders'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { serverScopedKey } from '@/lib/serverScope'
import type { TranscriptCache } from '@/lib/session-projection'

export interface ContextUsage {
  totalTokens: number
  usagePercentage: number | null
}

interface ContextUsageResult {
  usage: ContextUsage | null
  isLoading: boolean
}

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

export const useContextUsage = (
  sessionID: string | undefined,
  directory?: string,
  revertMessageID?: string,
): ContextUsageResult => {
  const serverId = useOpenCodeServerId()
  const transcriptQuery = useQuery<TranscriptCache>({
    queryKey: serverScopedKey(sessionTranscriptQueryKey(sessionID ?? ''), serverId),
    queryFn: skipToken,
  })
  const transcriptData = transcriptQuery.data
  const messagesLoading = transcriptQuery.isPending

  const { data: providersData } = useProviders(directory)
  const models = providersData?.models

  return useMemo(() => {
    const messages = transcriptData?.transcript.messages ?? []

    const boundaryIndex = revertMessageID
      ? messages.findIndex((message) => message.id === revertMessageID)
      : -1
    if (revertMessageID && boundaryIndex === -1) {
      return { usage: null, isLoading: messagesLoading }
    }

    const end = boundaryIndex === -1 ? messages.length : boundaryIndex
    const compactionIndex = lastCompletedCompactionIndex(messages, end)
    const assistantIndex = lastAssistantWithUsageIndex(messages, compactionIndex, end)
    const assistant = assistantIndex === -1 ? undefined : messages[assistantIndex]
    if (assistant?.type !== 'assistant' || assistant.tokens === undefined) {
      return { usage: null, isLoading: messagesLoading }
    }

    const { input, output, reasoning, cache } = assistant.tokens
    const totalTokens = input + output + reasoning + cache.read + cache.write
    if (totalTokens <= 0) {
      return { usage: null, isLoading: messagesLoading }
    }

    const model = models
      ? findModelInfo(models, { providerID: assistant.model.providerID, modelID: assistant.model.id })
      : undefined
    const contextLimit = model?.limit.context
    const usagePercentage = contextLimit ? Math.round((totalTokens / contextLimit) * 100) : null

    return { usage: { totalTokens, usagePercentage }, isLoading: messagesLoading }
  }, [transcriptData, messagesLoading, models, revertMessageID])
}
