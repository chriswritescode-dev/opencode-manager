import { useQueryClient } from '@tanstack/react-query'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'

const OPEN_CODE_RESTART_REQUIRED_MESSAGE =
  'Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.'

interface OpenCodeApplyFeedbackOptions {
  appliedMessage: string
  restartRequired?: boolean
}

/**
 * Reports the outcome of an OpenCode configuration write. An applied change is
 * announced with its own message, while a failed in-place reload points the user
 * at the restart banner; both paths refresh the caches backed by the running server.
 */
export function useOpenCodeApplyFeedback() {
  const queryClient = useQueryClient()

  return ({ appliedMessage, restartRequired }: OpenCodeApplyFeedbackOptions) => {
    showToast.success(restartRequired ? OPEN_CODE_RESTART_REQUIRED_MESSAGE : appliedMessage)
    invalidateConfigCaches(queryClient, { skipOpenCodeConfig: true })
  }
}
