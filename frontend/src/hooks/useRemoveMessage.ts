import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOpenCodeClient } from '@/api/opencode'
import { toast } from '@/lib/toast'
import type { MessageListResponse } from '@/api/types'

interface UseRemoveMessageOptions {
  opcodeUrl: string | null
  sessionId: string
  directory?: string
}

export function useRemoveMessage({ opcodeUrl, sessionId, directory }: UseRemoveMessageOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageID, partID }: { messageID: string, partID?: string }) => {
      if (!opcodeUrl) throw new Error('OpenCode URL not available')
      
      const client = createOpenCodeClient(opcodeUrl, directory)
      return client.revertMessage(sessionId, { messageID, partID })
    },
    onMutate: async ({ messageID }) => {
      const queryKey = ['opencode', 'messages', opcodeUrl, sessionId, directory]
      
      await queryClient.cancelQueries({ queryKey })
      
      const previousMessages = queryClient.getQueryData<MessageListResponse>(queryKey)
      
      if (previousMessages) {
        const messageIndex = previousMessages.findIndex(m => m.info.id === messageID)
        if (messageIndex !== -1) {
          const newMessages = previousMessages.slice(0, messageIndex)
          queryClient.setQueryData(queryKey, newMessages)
        }
      }
      
      return { previousMessages }
    },
    onError: (error, _, context) => {
      console.error('Failed to remove message:', error)
      
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ['opencode', 'messages', opcodeUrl, sessionId, directory],
          context.previousMessages
        )
      }
      
      toast.error('Failed to remove message')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'messages', opcodeUrl, sessionId, directory]
      })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', opcodeUrl, sessionId, directory]
      })
    }
  })
}

interface UseRefreshMessageOptions {
  opcodeUrl: string | null
  sessionId: string
  directory?: string
}

export function useRefreshMessage({ opcodeUrl, sessionId, directory }: UseRefreshMessageOptions) {
  const queryClient = useQueryClient()
  const removeMessage = useRemoveMessage({ opcodeUrl, sessionId, directory })

  return useMutation({
    mutationFn: async ({ 
      assistantMessageID, 
      userMessageContent,
      model,
      agent
    }: { 
      assistantMessageID: string
      userMessageContent: string
      model?: string
      agent?: string
    }) => {
      if (!opcodeUrl) throw new Error('OpenCode URL not available')
      
      await removeMessage.mutateAsync({ messageID: assistantMessageID })
      
      const client = createOpenCodeClient(opcodeUrl, directory)
      
      interface SendPromptRequest {
        parts: Array<{ type: 'text'; text: string }>
        model?: { providerID: string; modelID: string }
        agent?: string
      }
      
      const requestData: SendPromptRequest = {
        parts: [{ type: 'text', text: userMessageContent }]
      }
      
      if (model) {
        const [providerID, modelID] = model.split('/')
        if (providerID && modelID) {
          requestData.model = { providerID, modelID }
        }
      }
      
      if (agent) {
        requestData.agent = agent
      }
      
      return client.sendPrompt(sessionId, requestData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'messages', opcodeUrl, sessionId, directory]
      })
    },
    onError: (error) => {
      console.error('Failed to refresh message:', error)
      toast.error('Failed to refresh message')
    }
  })
}