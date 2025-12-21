import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOpenCodeClient } from '@/api/opencode'
import { showToast } from '@/lib/toast'
import type { MessageListResponse } from '@/api/types'

interface UseUndoMessageOptions {
  opcodeUrl: string | null
  sessionId: string
  directory?: string
  onSuccess?: (restoredPrompt: string) => void
}

export function useUndoMessage({ 
  opcodeUrl, 
  sessionId, 
  directory,
  onSuccess 
}: UseUndoMessageOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageID, messageContent }: { messageID: string, messageContent: string }) => {
      if (!opcodeUrl) throw new Error('OpenCode URL not available')
      
      const client = createOpenCodeClient(opcodeUrl, directory)
      await client.revertMessage(sessionId, { messageID })
      return messageContent
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
      console.error('Failed to undo message:', error)
      
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ['opencode', 'messages', opcodeUrl, sessionId, directory],
          context.previousMessages
        )
      }
      
      showToast.error('Failed to undo message')
    },
    onSuccess: (restoredPrompt) => {
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'messages', opcodeUrl, sessionId, directory]
      })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', opcodeUrl, sessionId, directory]
      })
      onSuccess?.(restoredPrompt)
    }
  })
}
