import { Bell, HelpCircle } from 'lucide-react'
import { PendingActionBadge } from '@/components/ui/pending-action-badge'
import { ScheduleReportsBell } from '@/components/notifications/ScheduleReportsBell'
import { usePermissions, useForms } from '@/contexts/EventContext'

interface PendingActionsGroupProps {
  showScheduleReports?: boolean
}

export function PendingActionsGroup({ showScheduleReports = true }: PendingActionsGroupProps) {
  const { pendingCount: permissionCount, setShowDialog, navigateToCurrent: navigateToPermission } = usePermissions()
  const { pendingCount: formCount, navigateToCurrent } = useForms()

  return (
    <>
      {showScheduleReports ? <ScheduleReportsBell /> : null}
      <PendingActionBadge
        count={permissionCount}
        icon={Bell}
        color="orange"
        onClick={() => {
          navigateToPermission()
          setShowDialog(true)
        }}
        label="permission"
      />
      <PendingActionBadge
        count={formCount}
        icon={HelpCircle}
        color="blue"
        onClick={navigateToCurrent}
        label="form"
      />
    </>
  )
}
