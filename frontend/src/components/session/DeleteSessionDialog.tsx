import { DeleteDialog } from '@/components/ui/delete-dialog'

interface DeleteSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  isDeleting?: boolean
  sessionCount?: number
}

export function DeleteSessionDialog({ open, onOpenChange, onConfirm, onCancel, isDeleting = false, sessionCount = 1 }: DeleteSessionDialogProps) {
  const isMultiple = sessionCount > 1
  const title = isMultiple ? "Delete Sessions" : "Delete Session"
  const description = isMultiple 
    ? <>Are you sure you want to delete <span className="text-destructive font-bold text-lg">{sessionCount}</span> sessions? This action cannot be undone.</>
    : "Are you sure you want to delete this session? This action cannot be undone."

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title={title}
      description={description}
      isDeleting={isDeleting}
    />
  )
}
