import { useMemo } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useProviders } from '@/hooks/useProviders'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'
import type { TranscriptCache } from '@/lib/session-projection'

interface ContextUsage {
  totalTokens: number
  contextLimit: number | null
  usagePercentage: number | null
  currentModel: string | null
  isLoading: boolean
}

export const useContextUsage = (sessionID: string | undefined, directory?: string): ContextUsage => {
  const transcriptQuery = useQuery<TranscriptCache>({
    queryKey: sessionTranscriptQueryKey(sessionID ?? ''),
    queryFn: skipToken,
  })
  const transcriptData = transcriptQuery.data
  const messagesLoading = transcriptQuery.isPending

  const { data: providersData } = useProviders(directory)
  const models = providersData?.models

  return useMemo(() => {
    const messages = transcriptData?.transcript.messages ?? []
    const assistantMessages = messages.filter(msg => msg.type === 'assistant') || []
    let latestAssistantMessage = assistantMessages[assistantMessages.length - 1]

    const sumTokens = (msg: typeof latestAssistantMessage) => {
      if (msg?.type !== 'assistant' || !msg.tokens) return 0
      return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read
    }

    if (sumTokens(latestAssistantMessage) === 0 && assistantMessages.length > 1) {
      latestAssistantMessage = assistantMessages[assistantMessages.length - 2]
    }

    const activeModel = latestAssistantMessage?.type === 'assistant' ? latestAssistantMessage.model : undefined

    const currentModel = activeModel
      ? `${activeModel.providerID}/${activeModel.id}`
      : null

    let contextLimit: number | null = null
    if (activeModel && models) {
      const model = models.find(item => item.providerID === activeModel.providerID && item.id === activeModel.id)
      if (model?.limit) {
        contextLimit = model.limit.context
      }
    }

    if (messages.length === 0) {
      return {
        totalTokens: 0,
        contextLimit,
        usagePercentage: contextLimit ? 0 : null,
        currentModel,
        isLoading: messagesLoading
      }
    }

    const totalTokens = sumTokens(latestAssistantMessage)

    const usagePercentage = contextLimit ? (totalTokens / contextLimit) * 100 : null

    return {
      totalTokens,
      contextLimit,
      usagePercentage,
      currentModel,
      isLoading: false
    }
  }, [transcriptData, messagesLoading, models])
}
