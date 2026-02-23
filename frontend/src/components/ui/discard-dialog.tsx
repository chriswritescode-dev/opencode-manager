import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[90%] sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>Discard Changes</DialogTitle>
          <DialogDescription>
            Are you sure you want to discard changes to {itemText}? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        
        <Alert className="overflow-hidden">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <AlertDescription>
            This will permanently delete your uncommitted changes to {itemText}. If these changes exist in the staging area, they will also be removed.
          </AlertDescription>
        </Alert>
        
        <DialogFooter className='gap-2'>
          <Button variant="outline" onClick={onCancel} disabled={isDiscarding}>
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={onConfirm} 
            disabled={isDiscarding}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold border-red-600"
          >
            {isDiscarding && 'Discarding...'}
            {!isDiscarding && 'Discard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
