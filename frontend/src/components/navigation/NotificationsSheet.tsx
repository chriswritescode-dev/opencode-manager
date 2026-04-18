import { BottomSheet, BottomSheetHeader, BottomSheetContent } from '@/components/ui/bottom-sheet'
import { usePermissions, useQuestions } from '@/contexts/EventContext'
import { Bell, HelpCircle } from 'lucide-react'

interface NotificationsSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function NotificationsSheet({ isOpen, onClose }: NotificationsSheetProps) {
  const {
    current: currentPermission,
    pendingCount: permissionCount,
    setShowDialog,
    navigateToCurrent: navigateToPermission,
  } = usePermissions()
  const {
    current: currentQuestion,
    pendingCount: questionCount,
    navigateToCurrent: navigateToQuestion,
  } = useQuestions()

  const handlePermissionClick = () => {
    navigateToPermission()
    setShowDialog(true)
    onClose()
  }

  const handleQuestionClick = () => {
    navigateToQuestion()
    onClose()
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} ariaLabel="Notifications">
      <BottomSheetHeader title="Notifications" />
      <BottomSheetContent className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-5 h-5 text-orange-500" />
            <h3 className="font-semibold text-foreground">Pending permissions</h3>
          </div>
          {permissionCount === 0 ? (
            <div className="text-muted-foreground text-sm py-4">
              You're all caught up
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {currentPermission && (
                <button
                  type="button"
                  onClick={handlePermissionClick}
                  className="flex flex-col items-start gap-1 p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left w-full"
                >
                  <span className="font-medium text-foreground capitalize">
                    {currentPermission.permission.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground truncate w-full">
                    {currentPermission.patterns?.[0] || 'View details'}
                  </span>
                </button>
              )}
              {permissionCount > 1 && (
                <div className="text-xs text-muted-foreground px-3">
                  +{permissionCount - 1} more
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-foreground">Pending questions</h3>
          </div>
          {questionCount === 0 ? (
            <div className="text-muted-foreground text-sm py-4">
              You're all caught up
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {currentQuestion && (
                <button
                  type="button"
                  onClick={handleQuestionClick}
                  className="flex flex-col items-start gap-1 p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left w-full"
                >
                  <span className="font-medium text-foreground">
                    {currentQuestion.questions?.[0]?.question || 'Question'}
                  </span>
                  <span className="text-xs text-muted-foreground truncate w-full">
                    Tap to view
                  </span>
                </button>
              )}
              {questionCount > 1 && (
                <div className="text-xs text-muted-foreground px-3">
                  +{questionCount - 1} more
                </div>
              )}
            </div>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  )
}
