import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'

interface DiscardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  fileCount: number
  isDiscarding?: boolean
}

export function DiscardDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  fileCount,
  isDiscarding = false
}: DiscardDialogProps) {
  const itemText = fileCount === 1 ? '1 file' : `${fileCount} files`

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title="Discard Changes"
      description={`Are you sure you want to discard changes to ${itemText}? This action cannot be undone.`}
      warning={`This will permanently delete your uncommitted changes to ${itemText}. If these changes exist in the staging area, they will also be removed.`}
      confirmLabel="Discard"
      pendingLabel="Discarding..."
      isPending={isDiscarding}
    />
  )
}
