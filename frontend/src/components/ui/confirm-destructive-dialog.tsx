import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ConfirmDestructiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  title: string
  description: ReactNode
  warning?: ReactNode
  children?: ReactNode
  confirmLabel: string
  pendingLabel?: string
  cancelLabel?: string
  isPending?: boolean
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  description,
  warning,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Cancel',
  isPending = false,
}: ConfirmDestructiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {warning && (
          <Alert className="overflow-hidden">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <AlertDescription className="break-all">{warning}</AlertDescription>
          </Alert>
        )}

        {children}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 sm:flex-none"
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 sm:flex-none bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold border-destructive"
          >
            {isPending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
