import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  commitRevert,
  parseModelRef,
  sendPrompt,
  stageRevert,
} from '@/api/opencode'
import { useSyncSessionSelection } from '@/hooks/useOpenCode'
import { showToast } from '@/lib/toast'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'

interface UseRemoveMessageOptions {
  sessionId: string
  directory?: string
}

export function useRemoveMessage({ sessionId, directory }: UseRemoveMessageOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageID }: { messageID: string }) => {
      await stageRevert(sessionId, messageID)
      await commitRevert(sessionId)
    },
    onError: () => {
      showToast.error('Failed to remove message')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionTranscriptQueryKey(sessionId) })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', sessionId, directory]
      })
    }
  })
}

interface UseRefreshMessageOptions {
  sessionId: string
  directory?: string
}

export function useRefreshMessage({ sessionId, directory }: UseRefreshMessageOptions) {
  const queryClient = useQueryClient()
  const removeMessage = useRemoveMessage({ sessionId, directory })
  const syncSelection = useSyncSessionSelection(directory)

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
      await removeMessage.mutateAsync({ messageID: assistantMessageID })

      const modelRef = model ? parseModelRef(model) : undefined
      await syncSelection({ sessionID: sessionId, model: modelRef, agent })

      await sendPrompt({
        sessionID: sessionId,
        text: userMessageContent,
      })

      return { userMessageContent }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionTranscriptQueryKey(sessionId) })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', sessionId, directory]
      })
    },
    onError: () => {
      showToast.error('Failed to refresh message')
    }
  })
}
