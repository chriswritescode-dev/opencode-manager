import { useCallback } from 'react'
import { useForms, usePermissions } from '@/contexts/EventContext'
import { useUnreadScheduleRuns } from '@/hooks/useSchedules'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'

export interface UseNotificationsActionReturn {
  permissionCount: number
  formCount: number
  reportCount: number
  count: number
  destructive: boolean
  label: string
  press: () => void
}

function describeCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function useNotificationsAction(): UseNotificationsActionReturn {
  const permissions = usePermissions()
  const forms = useForms()
  const { data } = useUnreadScheduleRuns()
  const { open } = useMobileTabBar()

  const permissionCount = permissions.pendingCount
  const formCount = forms.pendingCount
  const reportCount = data?.total ?? 0
  const count = permissionCount + formCount + reportCount
  const destructive = (data?.failed ?? 0) > 0

  const parts: string[] = []
  if (permissionCount > 0) parts.push(describeCount(permissionCount, 'permission', 'permissions'))
  if (formCount > 0) parts.push(describeCount(formCount, 'form', 'forms'))
  if (reportCount > 0) parts.push(describeCount(reportCount, 'unread report', 'unread reports'))
  const label = count === 0 ? 'Notifications' : `Notifications: ${parts.join(', ')}`

  const { navigateToCurrent: navigateToCurrentPermission, setShowDialog } = permissions
  const { navigateToCurrent: navigateToCurrentForm } = forms

  const press = useCallback(() => {
    if (count === 1 && permissionCount === 1) {
      navigateToCurrentPermission()
      setShowDialog(true)
      return
    }
    if (count === 1 && formCount === 1) {
      navigateToCurrentForm()
      return
    }
    open('notifications')
  }, [
    count,
    permissionCount,
    formCount,
    navigateToCurrentPermission,
    setShowDialog,
    navigateToCurrentForm,
    open,
  ])

  return {
    permissionCount,
    formCount,
    reportCount,
    count,
    destructive,
    label,
    press,
  }
}
