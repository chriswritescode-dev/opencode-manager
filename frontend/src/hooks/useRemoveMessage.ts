import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  commitRevert,
  sendPrompt,
  stageRevert,
} from '@/api/opencode'
import { parseOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { useSyncSessionSelection } from '@/hooks/useOpenCode'
import { showToast } from '@/lib/toast'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'

interface UseRemoveMessageOptions {
  sessionId: string
  directory?: string
}

export function useRemoveMessage({ sessionId, directory }: UseRemoveMessageOptions) {
  const queryClient = useQueryClient()
  const serverId = useOpenCodeServerId()

  return useMutation({
    mutationFn: async ({ messageID }: { messageID: string }) => {
      await stageRevert(sessionId, messageID, serverId)
      await commitRevert(sessionId, serverId)
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
  const serverId = useOpenCodeServerId()
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

      const modelRef = model ? parseOpenCodeModelRef(model) : undefined
      await syncSelection({ sessionID: sessionId, model: modelRef, agent })

      await sendPrompt(
        {
          sessionID: sessionId,
          text: userMessageContent,
        },
        serverId,
      )

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
