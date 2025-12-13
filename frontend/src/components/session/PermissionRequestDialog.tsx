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
import type { Permission, PermissionResponse } from '@/api/types'
import { cn } from '@/lib/utils'

interface PermissionRequestDialogProps {
  permission: Permission | null
  pendingCount: number
  onRespond: (permissionID: string, sessionID: string, response: PermissionResponse) => Promise<void>
  onDismiss: (permissionID: string) => void
}

function getPermissionTypeLabel(type: string): string {
  switch (type) {
    case 'bash':
      return 'Run Command'
    case 'edit':
      return 'Edit File'
    case 'write':
      return 'Write File'
    case 'webfetch':
      return 'Fetch URL'
    case 'external_directory':
      return 'External Access'
    case 'doom_loop':
      return 'Repeated Action'
    default:
      return type.charAt(0).toUpperCase() + type.slice(1)
  }
}

function getPermissionDetails(permission: Permission): { primary: string; secondary?: string } {
  const metadata = permission.metadata || {}
  
  switch (permission.type) {
    case 'bash': {
      const command = metadata.command as string | undefined
      if (command) {
        return { primary: command }
      }
      break
    }
    case 'edit':
    case 'write': {
      const filePath = metadata.filePath as string | undefined
      const diff = metadata.diff as string | undefined
      if (filePath) {
        return { 
          primary: filePath,
          secondary: diff ? diff.slice(0, 500) + (diff.length > 500 ? '\n...' : '') : undefined
        }
      }
      break
    }
    case 'webfetch': {
      const url = metadata.url as string | undefined
      if (url) {
        return { primary: url }
      }
      break
    }
    case 'external_directory': {
      const command = metadata.command as string | undefined
      const filepath = metadata.filepath as string | undefined
      if (command) {
        return { primary: command }
      }
      if (filepath) {
        return { primary: filepath }
      }
      break
    }
    case 'doom_loop': {
      const tool = metadata.tool as string | undefined
      const input = metadata.input
      if (tool) {
        return { 
          primary: `Tool: ${tool}`,
          secondary: input ? JSON.stringify(input, null, 2).slice(0, 300) : undefined
        }
      }
      break
    }
  }
  
  const patterns = Array.isArray(permission.pattern) 
    ? permission.pattern 
    : permission.pattern 
      ? [permission.pattern] 
      : []
  
  if (patterns.length > 0) {
    return { primary: patterns.join('\n') }
  }
  
  return { primary: '' }
}

export function PermissionRequestDialog({
  permission,
  pendingCount,
  onRespond,
  onDismiss,
}: PermissionRequestDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<PermissionResponse | null>(null)

  if (!permission) return null

  const handleResponse = async (response: PermissionResponse) => {
    setIsLoading(true)
    setLoadingAction(response)
    try {
      await onRespond(permission.id, permission.sessionID, response)
    } catch (error) {
      console.error('Failed to respond to permission:', error)
      onDismiss(permission.id)
    } finally {
      setIsLoading(false)
      setLoadingAction(null)
    }
  }

  const typeLabel = getPermissionTypeLabel(permission.type)
  const details = getPermissionDetails(permission)
  const hasMultiple = pendingCount > 1

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent hideCloseButton className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Permission Request
            {hasMultiple && (
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                +{pendingCount - 1} more
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {permission.title || `Allow ${typeLabel.toLowerCase()}?`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {typeLabel}
            </span>
          </div>
          
          {details.primary && (
            <div className="bg-muted/50 border rounded-md p-3 max-h-32 overflow-y-auto">
              <pre className="text-sm font-mono whitespace-pre-wrap break-all">
                {details.primary}
              </pre>
            </div>
          )}
          
          {details.secondary && (
            <div className="bg-muted/30 border rounded-md p-3 max-h-24 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
                {details.secondary}
              </pre>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Session: <span className="font-mono">{permission.sessionID.slice(0, 12)}...</span>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleResponse('reject')}
            disabled={isLoading}
            className={cn(
              "flex-1",
              loadingAction === 'reject' && "opacity-70"
            )}
          >
            {loadingAction === 'reject' ? 'Denying...' : 'Deny'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleResponse('once')}
            disabled={isLoading}
            className={cn(
              "flex-1",
              loadingAction === 'once' && "opacity-70"
            )}
          >
            {loadingAction === 'once' ? 'Allowing...' : 'Allow Once'}
          </Button>
          <Button
            variant="default"
            onClick={() => handleResponse('always')}
            disabled={isLoading}
            className={cn(
              "flex-1",
              loadingAction === 'always' && "opacity-70"
            )}
          >
            {loadingAction === 'always' ? 'Allowing...' : 'Allow Always'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
