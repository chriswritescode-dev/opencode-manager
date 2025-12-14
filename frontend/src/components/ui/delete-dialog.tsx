import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  title: string
  description: string
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[90%] sm:max-w-sm '>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        
        {itemName && (
          <Alert className="overflow-hidden">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <AlertDescription className="break-all">
              This will permanently delete "<span className="font-medium">{itemName}</span>". This action cannot be undone.
            </AlertDescription>
          </Alert>
        )}
        
        <DialogFooter className='gap-2'>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={onConfirm} 
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold border-red-600"
          >
            {isDeleting && 'Deleting...'}
            {!isDeleting && (title.includes('Configuration') ? 'Delete Configuration' : 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
