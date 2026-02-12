import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CopyButton } from '@/components/ui/copy-button'
import { Shield, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SSHHostKeyRequest } from '@/api/types'
import { showToast } from '@/lib/toast'

type SSHHostKeyResponse = 'accept' | 'reject'

interface SSHHostKeyDialogProps {
  request: SSHHostKeyRequest | null
  onRespond: (requestId: string, response: SSHHostKeyResponse) => Promise<void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  timeoutMs?: number
}

export function SSHHostKeyDialog({
  request,
  onRespond,
  open: parentOpen,
  onOpenChange,
  timeoutMs = 120_000
}: SSHHostKeyDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(0)

  useEffect(() => {
    if (!request) {
      setTimeRemaining(0)
      return
    }

    const elapsed = Date.now() - request.timestamp
    const remaining = Math.max(0, timeoutMs - elapsed)
    setTimeRemaining(Math.ceil(remaining / 1000))

    const interval = setInterval(() => {
      const currentElapsed = Date.now() - request.timestamp
      const currentRemaining = Math.max(0, timeoutMs - currentElapsed)
      setTimeRemaining(Math.ceil(currentRemaining / 1000))

      if (currentRemaining <= 0) {
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [request, timeoutMs])

  if (!request) return null
  if (parentOpen === false) return null

  const handleResponse = async (response: SSHHostKeyResponse) => {
    setIsLoading(true)
    try {
      await onRespond(request.id, response)
      if (response === 'accept') {
        showToast.success('Host key accepted')
      }
    } catch {
      showToast.error('Failed to respond to host key request. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const isExpired = timeRemaining === 0
  const WarningIcon = request.isKeyChanged ? ShieldAlert : Shield

  return (
    <Dialog open={parentOpen ?? true} onOpenChange={onOpenChange ?? (() => {})}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <WarningIcon className={cn(
              "h-5 w-5",
              request.isKeyChanged ? "text-red-500" : "text-amber-500"
            )} />
            <span>{request.isKeyChanged ? 'Host Key Changed' : 'Verify SSH Host Key'}</span>
          </DialogTitle>
          <DialogDescription>
            {request.isKeyChanged
              ? 'WARNING: The host key for this server has changed!'
              : 'Verify the authenticity of this SSH server before connecting.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {request.isKeyChanged && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">
                <strong>Security Warning:</strong> This could indicate a man-in-the-middle attack.
                Only proceed if you are certain the server is legitimate.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Host:</span>
              <span className="font-mono font-medium">{request.host}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">IP Address:</span>
              <span className="font-mono font-medium">{request.ip}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Key Type:</span>
              <span className="font-mono font-medium">{request.keyType}</span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground">Fingerprint:</span>
              <div className="flex items-center gap-2 flex-1 justify-end">
                <span className="font-mono text-xs break-all">{request.fingerprint}</span>
                <CopyButton content={request.fingerprint} variant="ghost" iconSize="sm" />
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Auto-reject in:</span>
              <span className={cn("font-mono", isExpired && "text-red-500")}>
                {isExpired ? 'Expired' : formatTime(timeRemaining)}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => handleResponse('reject')}
            disabled={isLoading || isExpired}
            className="w-full sm:flex-1 text-sm h-9 sm:h-10"
          >
            {isLoading ? 'Processing...' : 'Reject'}
          </Button>
          <Button
            variant={request.isKeyChanged ? 'destructive' : 'default'}
            onClick={() => handleResponse('accept')}
            disabled={isLoading || isExpired}
            className="w-full sm:flex-1 text-sm h-9 sm:h-10"
          >
            {isLoading ? 'Processing...' : 'Accept'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
