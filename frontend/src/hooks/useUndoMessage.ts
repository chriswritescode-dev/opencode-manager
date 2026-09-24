import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clearRevert, stageRevert } from '@/api/opencode'
import { showToast } from '@/lib/toast'
import { sessionTranscriptQueryKey } from '@/lib/queryInvalidation'

interface UseUndoMessageOptions {
  sessionId: string
  directory?: string
  onSuccess?: (restoredPrompt: string) => void
}

export function useUndoMessage({
  sessionId,
  directory,
  onSuccess
}: UseUndoMessageOptions) {
  const queryClient = useQueryClient()

  return useMutation<string, Error, { messageID: string; messageContent: string }>({
    mutationFn: async ({ messageID, messageContent }: { messageID: string, messageContent: string }) => {
      await stageRevert(sessionId, messageID)
      return messageContent
    },
    onError: () => {
      showToast.error('Failed to undo message')
    },
    onSuccess: (restoredPrompt) => {
      queryClient.invalidateQueries({ queryKey: sessionTranscriptQueryKey(sessionId) })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', sessionId, directory]
      })
      onSuccess?.(restoredPrompt)
    }
  })
}

interface UseRedoMessageOptions {
  sessionId: string
  directory?: string
}

export function useRedoMessage({ sessionId, directory }: UseRedoMessageOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => clearRevert(sessionId),
    onError: () => {
      showToast.error('Failed to redo message')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionTranscriptQueryKey(sessionId) })
      queryClient.invalidateQueries({
        queryKey: ['opencode', 'session', sessionId, directory]
      })
    }
  })
}
