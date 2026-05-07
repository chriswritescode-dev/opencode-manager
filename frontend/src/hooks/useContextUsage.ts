import { useMemo } from 'react'
import { useMessages } from './useOpenCode'
import { useQuery } from '@tanstack/react-query'
import { fetchWrapper } from '@/api/fetchWrapper'

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
  return fetchWrapper<ProvidersResponse>(`${opcodeUrl}/config/providers`)
}

export const useContextUsage = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string): ContextUsage => {
  const { data: messages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionID, directory)

  const { data: providersData } = useQuery({
    queryKey: ['providers', opcodeUrl],
    queryFn: () => {
      if (!opcodeUrl) throw new Error('opcodeUrl is required')
      return fetchProviders(opcodeUrl)
    },
    enabled: !!opcodeUrl,
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    const assistantMessages = messages?.filter(msg => msg.info.role === 'assistant') || []
    let latestAssistantMessage = assistantMessages[assistantMessages.length - 1]

    const sumTokens = (msg: typeof latestAssistantMessage) => {
      if (msg?.info.role !== 'assistant') return 0
      const msgInfo = msg.info as { tokens?: { input: number; output: number; reasoning: number; cache?: { read: number } } }
      return (msgInfo.tokens?.input ?? 0) + (msgInfo.tokens?.output ?? 0) + (msgInfo.tokens?.reasoning ?? 0) + (msgInfo.tokens?.cache?.read ?? 0)
    }

    if (sumTokens(latestAssistantMessage) === 0 && assistantMessages.length > 1) {
      latestAssistantMessage = assistantMessages[assistantMessages.length - 2]
    }

    const currentModel = (() => {
      if (!latestAssistantMessage || latestAssistantMessage.info.role !== 'assistant') {
        return null
      }
      const msg = latestAssistantMessage.info as { providerID?: string; modelID?: string }
      if (msg.providerID && msg.modelID) {
        return `${msg.providerID}/${msg.modelID}`
      }
      return null
    })()

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
    
    const totalTokens = sumTokens(latestAssistantMessage)

    const usagePercentage = contextLimit ? (totalTokens / contextLimit) * 100 : null

    return {
      totalTokens,
      contextLimit,
      usagePercentage,
      currentModel,
      isLoading: false
    }
  }, [messages, messagesLoading, providersData])
}
