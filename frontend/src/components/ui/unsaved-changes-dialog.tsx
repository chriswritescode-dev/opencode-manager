import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'

interface UnsavedChangesDialogProps {
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
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onDiscard}
      onCancel={onKeepEditing}
      title="Unsaved Changes"
      description={itemName ? `You have unsaved edits to ${itemName}.` : 'You have unsaved edits.'}
      warning="Discarding will permanently lose these edits."
      confirmLabel="Discard"
      cancelLabel="Keep Editing"
    />
  )
}
