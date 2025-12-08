import { useMemo } from 'react'
import { useMessages } from './useOpenCode'
import { useQuery } from '@tanstack/react-query'
import { useModelSelection } from './useModelSelection'

interface ContextUsage {
  totalTokens: number
  contextLimit: number | null
  usagePercentage: number | null
  currentModel: string | null
  isLoading: boolean
}

interface ModelLimit {
  context: number
  output: number
}

interface ProviderModel {
  id: string
  name: string
  limit: ModelLimit
}

interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

interface ProvidersResponse {
  providers: Provider[]
}

async function fetchProviders(opcodeUrl: string): Promise<ProvidersResponse> {
  const response = await fetch(`${opcodeUrl}/config/providers`)
  if (!response.ok) {
    throw new Error('Failed to fetch providers')
  }
  return response.json()
}

export const useContextUsage = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string): ContextUsage => {
  const { data: messages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionID, directory)
  const { modelString } = useModelSelection(opcodeUrl, directory)

  const { data: providersData } = useQuery({
    queryKey: ['providers', opcodeUrl],
    queryFn: () => fetchProviders(opcodeUrl!),
    enabled: !!opcodeUrl,
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    const currentModel = modelString || null

    const assistantMessages = messages?.filter(msg => msg.info.role === 'assistant') || []
    let latestAssistantMessage = assistantMessages[assistantMessages.length - 1]
    
    if (latestAssistantMessage?.info.role === 'assistant') {
      const tokens = latestAssistantMessage.info.tokens.input + latestAssistantMessage.info.tokens.output + latestAssistantMessage.info.tokens.reasoning
      if (tokens === 0 && assistantMessages.length > 1) {
        latestAssistantMessage = assistantMessages[assistantMessages.length - 2]
      }
    }

    let contextLimit: number | null = null
    if (currentModel && providersData) {
      const [providerId, modelId] = currentModel.split('/')
      const provider = providersData.providers.find(p => p.id === providerId)
      if (provider?.models) {
        const model = provider.models[modelId]
        if (model?.limit) {
          contextLimit = model.limit.context
        }
      }
    }

    if (!messages || messages.length === 0) {
      return {
        totalTokens: 0,
        contextLimit,
        usagePercentage: contextLimit ? 0 : null,
        currentModel,
        isLoading: messagesLoading
      }
    }
    
    let totalTokens = 0
    if (latestAssistantMessage?.info.role === 'assistant') {
      totalTokens = latestAssistantMessage.info.tokens.input + latestAssistantMessage.info.tokens.output + latestAssistantMessage.info.tokens.reasoning
    }

    const usagePercentage = contextLimit ? (totalTokens / contextLimit) * 100 : null

    return {
      totalTokens,
      contextLimit,
      usagePercentage,
      currentModel,
      isLoading: false
    }
  }, [messages, messagesLoading, modelString, providersData])
}
