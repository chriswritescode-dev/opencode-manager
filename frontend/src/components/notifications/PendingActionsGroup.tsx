import { Bell, HelpCircle } from 'lucide-react'
import { PendingActionBadge } from '@/components/ui/pending-action-badge'
import { usePermissions, useForms } from '@/contexts/EventContext'

export function PendingActionsGroup() {
  const { pendingCount: permissionCount, setShowDialog, navigateToCurrent: navigateToPermission } = usePermissions()
  const { pendingCount: formCount, navigateToCurrent } = useForms()

  return (
    <>
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
