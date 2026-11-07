import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface PromoteOutputDialogProps {
  open: boolean
  definitionId: string
  pending: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

/** Confirms replacing a global output definition whose id matches the one being saved. */
export function PromoteOutputDialog({
  open,
  definitionId,
  pending,
  error,
  onOpenChange,
  onConfirm,
  onCancel,
}: PromoteOutputDialogProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Replace the global "${definitionId}" output?`}</DialogTitle>
          <DialogDescription>A global output with this id already exists.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
