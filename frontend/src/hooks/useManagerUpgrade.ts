import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'

const UPGRADE_TOAST_ID = 'upgrade-manager'

/**
 * Manager self-upgrade state shared by the settings surfaces. `requestUpgrade`
 * first checks for active OpenCode sessions and opens a confirmation dialog
 * when any would be interrupted by the container recreate. The upgrade itself
 * runs in the background on the server; progress and terminal states are
 * surfaced through the polled job status.
 */
export function useManagerUpgrade() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activeSessionCount, setActiveSessionCount] = useState(0)

  const { data: status } = useQuery({
    queryKey: ['manager-upgrade-status'],
    queryFn: settingsApi.getManagerUpgradeStatus,
    refetchInterval: (q) => {
      const s = q.state.data?.job?.status
      return s === 'pulling' || s === 'recreating' ? 3000 : false
    },
  })

  const mutation = useMutation({
    mutationFn: () => settingsApi.startManagerUpgrade(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-upgrade-status'] })
    },
  })

  const job = status?.job
  const prevJobStatusRef = useRef(job?.status)
  useEffect(() => {
    const prev = prevJobStatusRef.current
    prevJobStatusRef.current = job?.status
    if (prev === undefined || prev === job?.status) return
    if (job?.status === 'failed') {
      showToast.error(job.error || 'Manager upgrade failed', { id: UPGRADE_TOAST_ID })
    } else if (job?.status === 'completed') {
      showToast.success('Manager upgraded successfully', { id: UPGRADE_TOAST_ID })
    }
  }, [job?.status, job?.error])

  const performUpgrade = async () => {
    showToast.loading('Upgrading Manager — the app will restart…', { id: UPGRADE_TOAST_ID })
    try {
      await mutation.mutateAsync()
    } catch (error) {
      showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to upgrade Manager'), { id: UPGRADE_TOAST_ID })
    }
  }

  const requestUpgrade = async () => {
    try {
      const { count } = await settingsApi.getActiveOpenCodeSessions()
      if (count > 0) {
        setActiveSessionCount(count)
        setConfirmOpen(true)
        return
      }
    } catch {
      // Fall through to an immediate upgrade when the active-session probe fails.
    }
    await performUpgrade()
  }

  const confirmUpgrade = async () => {
    setConfirmOpen(false)
    await performUpgrade()
  }

  return {
    status,
    isSupported: status?.supported ?? false,
    requestUpgrade,
    confirmUpgrade,
    confirmOpen,
    setConfirmOpen,
    activeSessionCount,
    isUpgrading: mutation.isPending || job?.status === 'pulling' || job?.status === 'recreating',
  }
}
