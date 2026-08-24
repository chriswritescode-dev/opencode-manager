import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { invalidateConfigCaches, updateOpenCodeVersionCaches } from '@/lib/queryInvalidation'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'

const RESTART_TOAST_ID = 'opencode-restart'
const UPGRADE_TOAST_ID = 'upgrade-opencode'

/**
 * Centralizes OpenCode server restart/upgrade actions shared by the settings
 * surfaces. A restart always routes through `POST /opencode-restart`, which
 * aborts and resumes in-flight sessions; `requestRestart` first checks for
 * active sessions and opens a confirmation dialog when any would be interrupted.
 */
export function useOpenCodeServerActions() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activeSessionCount, setActiveSessionCount] = useState(0)

  const restartServerMutation = useMutation({
    mutationFn: async () => settingsApi.restartOpenCodeServer(),
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
    },
  })

  const upgradeOpenCodeMutation = useMutation({
    mutationFn: async () => settingsApi.upgradeOpenCode(),
    onSuccess: (data) => {
      if (data.upgraded && data.newVersion) {
        updateOpenCodeVersionCaches(queryClient, data.newVersion)
      }
      invalidateConfigCaches(queryClient)
      if (data.upgraded) {
        showToast.success(`Upgraded to v${data.newVersion} and server restarted`, { id: UPGRADE_TOAST_ID })
      } else {
        showToast.success('OpenCode is already up to date', { id: UPGRADE_TOAST_ID })
      }
    },
    onError: (error) => {
      const defaultMessage = 'Failed to upgrade OpenCode'

      if (error && typeof error === 'object' && 'response' in error) {
        const response = (error as { response?: { data?: { recovered?: boolean; recoveryMessage?: string; newVersion?: string } } }).response
        const data = response?.data

        if (data?.recovered && data.newVersion) {
          updateOpenCodeVersionCaches(queryClient, data.newVersion)
          showToast.success(`Upgrade failed but server recovered at v${data.newVersion}`, { id: UPGRADE_TOAST_ID })
        } else {
          showToast.error(data?.recoveryMessage || defaultMessage, { id: UPGRADE_TOAST_ID })
        }
      } else {
        showToast.error(defaultMessage, { id: UPGRADE_TOAST_ID })
      }
      invalidateConfigCaches(queryClient)
    },
  })

  const performRestart = async () => {
    showToast.loading('Restarting OpenCode server...', { id: RESTART_TOAST_ID })
    try {
      await restartServerMutation.mutateAsync()
      showToast.success('Server restarted successfully', { id: RESTART_TOAST_ID })
    } catch (error) {
      showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to restart OpenCode server'), { id: RESTART_TOAST_ID })
    }
  }

  const probeActiveSessionCount = useCallback(async (): Promise<number> => {
    try {
      const { count } = await settingsApi.getActiveOpenCodeSessions()
      return count
    } catch {
      return 0
    }
  }, [])

  const openRestartPrompt = useCallback(async () => {
    const count = await probeActiveSessionCount()
    setActiveSessionCount(count)
    setConfirmOpen(true)
  }, [probeActiveSessionCount, setActiveSessionCount, setConfirmOpen])

  const requestRestart = async () => {
    const count = await probeActiveSessionCount()
    if (count > 0) {
      setActiveSessionCount(count)
      setConfirmOpen(true)
      return
    }
    await performRestart()
  }

  const confirmRestart = async () => {
    await performRestart()
    setConfirmOpen(false)
  }

  const performUpgrade = async () => {
    showToast.loading('Upgrading OpenCode...', { id: UPGRADE_TOAST_ID })
    try {
      await upgradeOpenCodeMutation.mutateAsync()
    } catch (error) {
      showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to upgrade OpenCode'), { id: UPGRADE_TOAST_ID })
    }
  }

  return {
    restartServerMutation,
    upgradeOpenCodeMutation,
    confirmOpen,
    setConfirmOpen,
    activeSessionCount,
    requestRestart,
    openRestartPrompt,
    confirmRestart,
    performUpgrade,
  }
}
