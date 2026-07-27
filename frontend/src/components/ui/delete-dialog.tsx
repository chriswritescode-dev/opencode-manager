import type { ReactNode } from 'react'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  title: string
  description: ReactNode
  itemName?: string
  isDeleting?: boolean
}

export function DeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  description,
  itemName,
  isDeleting = false
}: DeleteDialogProps) {
  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title={title}
      description={description}
      warning={itemName ? (
        <>This will permanently delete "<span className="font-medium">{itemName}</span>". This action cannot be undone.</>
      ) : undefined}
      confirmLabel={title.includes('Configuration') ? 'Delete Configuration' : 'Delete'}
      pendingLabel="Deleting..."
      isPending={isDeleting}
    />
  )
}
