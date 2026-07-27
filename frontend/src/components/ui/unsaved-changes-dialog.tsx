import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'

export interface UnsavedChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
  onKeepEditing: () => void
  itemName?: string
}

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  onDiscard,
  onKeepEditing,
  itemName,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Unsaved Changes</DialogTitle>
          <DialogDescription>
            {itemName
              ? `You have unsaved edits to ${itemName}.`
              : 'You have unsaved edits.'}
          </DialogDescription>
        </DialogHeader>

        <Alert className="overflow-hidden">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <AlertDescription>
            Discarding will permanently lose these edits.
          </AlertDescription>
        </Alert>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onKeepEditing}
            className="flex-1 sm:flex-none"
          >
            Keep Editing
          </Button>
          <Button
            variant="destructive"
            onClick={onDiscard}
            className="flex-1 sm:flex-none"
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
