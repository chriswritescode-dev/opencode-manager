import { useQueryClient } from '@tanstack/react-query'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'

const OPEN_CODE_RESTART_REQUIRED_MESSAGE =
  'Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.'

interface OpenCodeApplyFeedbackOptions {
  appliedMessage: string
  restartRequired?: boolean
}

export function useOpenCodeApplyFeedback() {
  const queryClient = useQueryClient()

  return ({ appliedMessage, restartRequired }: OpenCodeApplyFeedbackOptions) => {
    showToast.success(restartRequired ? OPEN_CODE_RESTART_REQUIRED_MESSAGE : appliedMessage)
    invalidateConfigCaches(queryClient, { skipOpenCodeConfig: true })
  }
}
