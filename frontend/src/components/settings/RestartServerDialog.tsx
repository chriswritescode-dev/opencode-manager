import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

interface RestartServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  isRestarting?: boolean
  activeSessionCount?: number
}

export function RestartServerDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  isRestarting = false,
  activeSessionCount,
}: RestartServerDialogProps) {
  const isConfirmDisabled = isRestarting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Restart OpenCode Server?</DialogTitle>
          <DialogDescription>
            {activeSessionCount && activeSessionCount > 0
              ? `${activeSessionCount} session${activeSessionCount === 1 ? '' : 's'} ${activeSessionCount === 1 ? 'is' : 'are'} currently working. Restarting will interrupt ${activeSessionCount === 1 ? 'it' : 'them'} and send "continue" to resume after the server is healthy.`
              : 'Restart the OpenCode server after your changes are saved to apply them to the running server.'
            }
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isRestarting}>
            Later
          </Button>
          <Button onClick={onConfirm} disabled={isConfirmDisabled}>
            {isRestarting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Restarting...
              </>
            ) : (
              'Restart now'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
