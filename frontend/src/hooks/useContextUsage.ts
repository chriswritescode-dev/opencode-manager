import { useMemo } from 'react'
import { useMessages } from './useOpenCode'
import { useQuery } from '@tanstack/react-query'
import { useModelSelection } from './useModelSelection'
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
  const { modelString: globalModelString } = useModelSelection(opcodeUrl, directory)
  const modelString = globalModelString

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
    const currentModel = modelString || null

    const assistantMessages = messages?.filter(msg => msg.info.role === 'assistant') || []
    let latestAssistantMessage = assistantMessages[assistantMessages.length - 1]
    
    if (latestAssistantMessage?.info.role === 'assistant') {
      const msgInfo = latestAssistantMessage.info as { tokens?: { input: number; output: number; reasoning: number; cache?: { read: number } } }
      const tokens = (msgInfo.tokens?.input ?? 0) + (msgInfo.tokens?.output ?? 0) + (msgInfo.tokens?.reasoning ?? 0) + (msgInfo.tokens?.cache?.read ?? 0)
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
      const msgInfo = latestAssistantMessage.info as { tokens?: { input: number; output: number; reasoning: number; cache?: { read: number } } }
      totalTokens = (msgInfo.tokens?.input ?? 0) + (msgInfo.tokens?.output ?? 0) + (msgInfo.tokens?.reasoning ?? 0) + (msgInfo.tokens?.cache?.read ?? 0)
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
