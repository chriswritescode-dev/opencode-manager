import { Bell, HelpCircle } from 'lucide-react'
import { PendingActionBadge } from '@/components/ui/pending-action-badge'
import { usePermissions, useQuestions } from '@/contexts/EventContext'

export function PendingActionsGroup() {
  const { pendingCount: permissionCount, setShowDialog, navigateToCurrent: navigateToPermission } = usePermissions()
  const { pendingCount: questionCount, navigateToCurrent } = useQuestions()

  return (
    <>
      <PendingActionBadge
        count={permissionCount}
        icon={Bell}
        color="warning"
        onClick={() => {
          navigateToPermission()
          setShowDialog(true)
        }}
        label="permission"
      />
      <PendingActionBadge
        count={questionCount}
        icon={HelpCircle}
        color="info"
        onClick={navigateToCurrent}
        label="question"
      />
    </>
  )
}
