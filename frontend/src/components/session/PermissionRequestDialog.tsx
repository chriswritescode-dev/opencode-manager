import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { PermissionRequest, PermissionResponse } from '@/api/types'
import { getPermissionLabel, getPermissionDetail } from '@opencode-manager/shared/notifications'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'

interface PermissionRequestDialogProps {
  permission: PermissionRequest | null
  pendingCount: number
  isFromDifferentSession?: boolean
  sessionTitle?: string
  repoDirectory?: string | null
  onRespond: (permissionID: string, sessionID: string, response: PermissionResponse) => Promise<void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function PermissionRequestDialog({
  permission,
  pendingCount,
  isFromDifferentSession,
  sessionTitle,
  repoDirectory,
  onRespond,
  open: parentOpen,
  onOpenChange,
}: PermissionRequestDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<PermissionResponse | null>(null)

  if (!permission) return null
  if (parentOpen === false) return null

  const handleResponse = async (response: PermissionResponse) => {
    setIsLoading(true)
    setLoadingAction(response)
    try {
      await onRespond(permission.id, permission.sessionID, response)
    } catch {
      showToast.error('Failed to respond to permission. Please try again.')
    } finally {
      setIsLoading(false)
      setLoadingAction(null)
    }
  }

  const typeLabel = getPermissionLabel(permission.permission)
  const details = getPermissionDetail(permission)
  const hasMultiple = pendingCount > 1
  const displaySessionName = sessionTitle || `Session ${permission.sessionID.slice(0, 8)}...`

  return (
    <Dialog open={parentOpen ?? true} onOpenChange={onOpenChange ?? (() => {})}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Permission Request</span>
            {hasMultiple && (
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full whitespace-nowrap">
                +{pendingCount - 1} more
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="break-all">
            {`Allow ${typeLabel.toLowerCase()}?`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {typeLabel}
            </span>
          </div>
          
          {details.primary && (
            <div className="bg-muted/50 border rounded-md p-2 sm:p-3 max-h-32 overflow-y-auto overflow-x-hidden">
              <pre className="text-xs sm:text-sm font-mono whitespace-pre-wrap break-all w-full">
                {details.primary}
              </pre>
            </div>
          )}
          
          {details.secondary && (
            <div className="bg-muted/30 border rounded-md p-2 sm:p-3 max-h-24 overflow-y-auto overflow-x-hidden">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all w-full text-muted-foreground">
                {details.secondary}
              </pre>
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            {repoDirectory && (
              <div className="truncate">
                Repo: <span className="font-medium">{repoDirectory.split('/').pop() ?? repoDirectory}</span>
              </div>
            )}
            {isFromDifferentSession ? (
              <div className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-md px-2 py-1.5 truncate">
                From another session: <span className="font-medium">{displaySessionName}</span>
              </div>
            ) : (
              <div className="truncate">
                Session: <span className="font-medium">{displaySessionName}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => handleResponse('reject')}
            disabled={isLoading}
            className={cn(
              "w-full sm:flex-1 text-sm h-9 sm:h-10",
              loadingAction === 'reject' && "opacity-70"
            )}
          >
            {loadingAction === 'reject' ? 'Denying...' : 'Deny'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleResponse('always')}
            disabled={isLoading}
            className={cn(
              "w-full sm:flex-1 text-sm h-9 sm:h-10",
              loadingAction === 'always' && "opacity-70"
            )}
          >
            {loadingAction === 'always' ? 'Allowing...' : 'Allow Always'}
          </Button>
          <Button
            variant="default"
            onClick={() => handleResponse('once')}
            disabled={isLoading}
            className={cn(
              "w-full sm:flex-1 text-sm h-9 sm:h-10",
              loadingAction === 'once' && "opacity-70"
            )}
          >
            {loadingAction === 'once' ? 'Allowing...' : 'Allow Once'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
