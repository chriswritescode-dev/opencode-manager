import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { refreshOpenCodeServerCaches } from '@/lib/queryInvalidation'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'

const RESTART_TOAST_ID = 'opencode-restart'
const UPGRADE_TOAST_ID = 'upgrade-opencode'

const upgradeErrorSchema = z.object({
  response: z
    .object({
      data: z
        .object({
          recovered: z.boolean().optional(),
          recoveryMessage: z.string().optional(),
          newVersion: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
})

export function useOpenCodeServerActions() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activeSessionCount, setActiveSessionCount] = useState(0)

  const restartServerMutation = useMutation({
    mutationFn: async () => settingsApi.restartOpenCodeServer(),
    onSuccess: () => {
      refreshOpenCodeServerCaches(queryClient)
    },
  })

  const upgradeOpenCodeMutation = useMutation({
    mutationFn: async () => settingsApi.upgradeOpenCode(),
    onSuccess: (data) => {
      refreshOpenCodeServerCaches(queryClient, data.upgraded ? data.newVersion ?? undefined : undefined)
      if (data.upgraded) {
        showToast.success(`Upgraded to v${data.newVersion} and server restarted`, { id: UPGRADE_TOAST_ID })
      } else {
        showToast.success('OpenCode is already up to date', { id: UPGRADE_TOAST_ID })
      }
    },
    onError: (error) => {
      const defaultMessage = 'Failed to upgrade OpenCode'

      const parsed = upgradeErrorSchema.safeParse(error)
      const data = parsed.success ? parsed.data.response?.data : undefined

      if (data?.recovered && data.newVersion) {
        refreshOpenCodeServerCaches(queryClient, data.newVersion)
        showToast.success(`Upgrade failed but server recovered at v${data.newVersion}`, { id: UPGRADE_TOAST_ID })
      } else {
        refreshOpenCodeServerCaches(queryClient)
        showToast.error(data?.recoveryMessage || defaultMessage, { id: UPGRADE_TOAST_ID })
      }
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

  const requestRestart = async () => {
    try {
      const { count } = await settingsApi.getActiveOpenCodeSessions()
      if (count > 0) {
        setActiveSessionCount(count)
        setConfirmOpen(true)
        return
      }
    } catch {
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
    confirmRestart,
    performUpgrade,
  }
}
