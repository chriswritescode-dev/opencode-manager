import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOpenCodeClient } from '@/api/opencode'
import { showToast } from '@/lib/toast'
import type { MessageWithParts, MessageListResponse } from '@/api/types'
import { useSessionStatus } from '@/stores/sessionStatusStore'

interface UseRemoveMessageOptions {
  opcodeUrl: string | null
  sessionId: string
  directory?: string
}

interface RemoveMessageContext {
  previousMessages?: MessageListResponse
}

export function useRemoveMessage({ opcodeUrl, sessionId, directory }: UseRemoveMessageOptions) {
  const queryClient = useQueryClient()

  return useMutation<unknown, Error, { messageID: string; partID?: string }, RemoveMessageContext>({
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
    onError: (_error, _context) => {
      if (_context?.previousMessages) {
        queryClient.setQueryData(
          ['opencode', 'messages', opcodeUrl, sessionId, directory],
          _context.previousMessages
        )
      }
      
      showToast.error('Failed to remove message')
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
  const setSessionStatus = useSessionStatus((state) => state.setStatus)

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
      
      setSessionStatus(sessionId, { type: 'busy' })
      
      await removeMessage.mutateAsync({ messageID: assistantMessageID })
      
      const client = createOpenCodeClient(opcodeUrl, directory)
      
      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`
      const userMessage = {
        info: {
          id: optimisticUserID,
          role: 'user' as const,
          sessionID: sessionId,
          time: { created: Date.now() }
        },
        parts: [{
          id: `${optimisticUserID}_part_0`,
          type: 'text' as const,
          text: userMessageContent,
          messageID: optimisticUserID,
          sessionID: sessionId
        }]
      } as MessageWithParts

      queryClient.setQueryData<MessageListResponse>(
        ['opencode', 'messages', opcodeUrl, sessionId, directory],
        (old) => [...(old || []), userMessage]
      )
      
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
      
      await client.sendPrompt(sessionId, requestData)

      return { optimisticUserID, userMessageContent }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'messages', opcodeUrl, sessionId, directory]
      })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', opcodeUrl, sessionId, directory]
      })
    },
    onError: (_, variables) => {
      void variables
      setSessionStatus(sessionId, { type: 'idle' })
      queryClient.setQueryData<MessageListResponse>(
        ['opencode', 'messages', opcodeUrl, sessionId, directory],
        (old) => {
          const messages = old || []
          const optimisticIndex = messages.findIndex((m) => m.info.id.startsWith('optimistic_user_'))
          if (optimisticIndex !== -1) {
            return messages.slice(0, optimisticIndex)
          }
          return messages
        }
      )
      showToast.error('Failed to refresh message')
    }
  })
}