import { useEffect, useRef } from 'react'
import { showToast } from '@/lib/toast'
import { getOpenCodeServerIssue, useServerHealth } from '@/hooks/useServerHealth'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'

export const OPENCODE_FAILURE_TOAST_ID = 'opencode-server-failure'

/**
 * Raises one persistent error toast per distinct terminal OpenCode server
 * failure (startup failure or exhausted recovery), offering to open the Logs
 * settings tab or restart the server, and announces when the server recovers.
 */
export function useOpenCodeFailureToast(enabled: boolean, onRestart: () => void) {
  const { data: health } = useServerHealth(enabled)
  const { openTab } = useSettingsDialog()
  const notifiedFailureRef = useRef<string | null>(null)

  const issue = getOpenCodeServerIssue(health)
  const failureMessage = issue?.state === 'failed' ? issue.message : null
  const isHealthy = health?.opencodeLifecycle ? health.opencodeLifecycle.healthy : health?.opencode === 'healthy'

  useEffect(() => {
    if (failureMessage !== null) {
      if (notifiedFailureRef.current === failureMessage) return
      notifiedFailureRef.current = failureMessage
      showToast.error('OpenCode server failed', {
        id: OPENCODE_FAILURE_TOAST_ID,
        duration: Infinity,
        description: failureMessage,
        action: { label: 'View logs', onClick: () => openTab('logs') },
        cancel: { label: 'Restart', onClick: onRestart },
      })
      return
    }

    if (isHealthy && notifiedFailureRef.current !== null) {
      notifiedFailureRef.current = null
      showToast.dismiss(OPENCODE_FAILURE_TOAST_ID)
      showToast.success('OpenCode server is back online')
    }
  }, [failureMessage, isHealthy, openTab, onRestart])
}
