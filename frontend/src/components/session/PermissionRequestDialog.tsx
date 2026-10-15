import { useEffect, useId, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PermissionResponse } from '@/api/types'
import type { PermissionRequest } from '@opencode-manager/shared/opencode'
import {
  getPermissionLabel,
  getPermissionDetail,
  getPermissionAlwaysScope,
} from '@opencode-manager/shared/notifications'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'

interface PermissionRequestDialogProps {
  permission: PermissionRequest | null
  pendingCount: number
  isFromDifferentSession?: boolean
  sessionTitle?: string
  repoDirectory?: string | null
  onOpenSession?: () => void
  onRespond: (
    permissionID: string,
    sessionID: string,
    response: PermissionResponse,
    message?: string,
  ) => Promise<void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function PermissionRequestDialog({
  permission,
  pendingCount,
  isFromDifferentSession,
  sessionTitle,
  repoDirectory,
  onOpenSession,
  onRespond,
  open: parentOpen,
  onOpenChange,
}: PermissionRequestDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<PermissionResponse | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const reasonInputId = useId()

  useEffect(() => {
    setRejectReason('')
  }, [permission?.id])

  if (!permission) return null
  if (parentOpen === false) return null

  const handleResponse = async (response: PermissionResponse) => {
    setIsLoading(true)
    setLoadingAction(response)
    const message = response === 'reject' ? rejectReason.trim() : ''
    try {
      await onRespond(permission.id, permission.sessionID, response, message === '' ? undefined : message)
    } catch {
      showToast.error('Failed to respond to permission. Please try again.')
    } finally {
      setIsLoading(false)
      setLoadingAction(null)
    }
  }

  const typeLabel = getPermissionLabel(permission.action)
  const details = getPermissionDetail(permission)
  const alwaysScope = getPermissionAlwaysScope(permission)
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

          {permission.message && (
            <p className="text-xs sm:text-sm break-words">{permission.message}</p>
          )}

          {details.primary && (
            <div className="space-y-1">
              {details.label && (
                <span className="block text-xs font-medium text-muted-foreground">{details.label}</span>
              )}
              <div className="bg-muted/50 border rounded-md p-2 sm:p-3 max-h-32 overflow-y-auto overflow-x-hidden">
                <pre className="text-xs sm:text-sm font-mono whitespace-pre-wrap break-all w-full">
                  {details.primary}
                </pre>
              </div>
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
              <div className="truncate" title={repoDirectory}>
                Repo: <span className="font-medium">{repoDirectory.split('/').pop() ?? repoDirectory}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              {isFromDifferentSession ? (
                <div className="bg-warning/10 text-warning border border-warning/20 rounded-md px-2 py-1.5 truncate min-w-0 flex-1">
                  From another session: <span className="font-medium">{displaySessionName}</span>
                </div>
              ) : (
                <div className="truncate min-w-0 flex-1">
                  Session: <span className="font-medium">{displaySessionName}</span>
                </div>
              )}
              {onOpenSession && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={onOpenSession}
                  className="h-auto shrink-0 p-0 text-xs"
                >
                  Open session
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={reasonInputId} className="text-xs font-medium text-muted-foreground">
            Reason (optional)
          </label>
          <Textarea
            id={reasonInputId}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explain why this request is denied..."
            disabled={isLoading}
            className="min-h-[60px] text-[16px] sm:text-xs md:text-sm resize-none"
          />
        </div>

        {alwaysScope && (
          <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground space-y-1">
            <p>{alwaysScope.summary}</p>
            {alwaysScope.patterns.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5 font-mono break-all">
                {alwaysScope.patterns.map((pattern) => (
                  <li key={pattern}>{pattern}</li>
                ))}
              </ul>
            )}
          </div>
        )}

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
          {alwaysScope && (
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
          )}
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
