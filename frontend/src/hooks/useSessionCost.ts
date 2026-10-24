import { useMemo } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import { serverScopedKey } from '@/lib/serverScope'
import type { TranscriptCache } from '@/lib/session-projection'

export interface SessionCostSummary {
  totalCost: number
  totalTokens: number
  messageCount: number
}

interface SessionCostResult extends SessionCostSummary {
  isLoading: boolean
}

export const useSessionCost = (
  sessionID: string | undefined,
  revertMessageID?: string,
): SessionCostResult => {
  const serverId = useOpenCodeServerId()
  const transcriptQuery = useQuery<TranscriptCache>({
    queryKey: serverScopedKey(sessionTranscriptQueryKey(sessionID ?? ''), serverId),
    queryFn: skipToken,
  })
  const transcriptData = transcriptQuery.data
  const isLoading = transcriptQuery.isPending

  return useMemo(() => {
    const messages = transcriptData?.transcript.messages ?? []

    const boundaryIndex = revertMessageID
      ? messages.findIndex((message) => message.id === revertMessageID)
      : -1
    if (revertMessageID && boundaryIndex === -1) {
      return { totalCost: 0, totalTokens: 0, messageCount: 0, isLoading }
    }

    const end = boundaryIndex === -1 ? messages.length : boundaryIndex
    let totalCost = 0
    let totalTokens = 0
    let messageCount = 0
    for (let index = 0; index < end; index += 1) {
      const message = messages[index]
      if (message?.type !== 'assistant' || message.tokens === undefined) continue
      const { input, output, reasoning, cache } = message.tokens
      totalCost += message.cost ?? 0
      totalTokens += input + output + reasoning + cache.read
      messageCount += 1
    }

    // TODO: child/subagent session cost is not part of this transcript; fetch it separately if needed.
    return { totalCost, totalTokens, messageCount, isLoading }
  }, [transcriptData, isLoading, revertMessageID])
}
