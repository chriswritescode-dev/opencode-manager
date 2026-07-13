import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const itemText = fileCount === 1 ? t('discardDialog.oneFile') : t('discardDialog.nFiles', { count: fileCount })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[90%] sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>{t('discardDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('discardDialog.confirmChanges', { itemText })}
          </DialogDescription>
        </DialogHeader>
        
        <Alert className="overflow-hidden">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <AlertDescription>
            {t('discardDialog.permanentlyDelete', { itemText })}
          </AlertDescription>
        </Alert>
        
        <DialogFooter className='gap-2'>
          <Button variant="outline" onClick={onCancel} disabled={isDiscarding}>
            {t('common.cancel')}
          </Button>
          <Button 
            variant="destructive" 
            onClick={onConfirm} 
            disabled={isDiscarding}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold border-red-600"
          >
            {isDiscarding && t('discardDialog.discarding')}
            {!isDiscarding && t('discardDialog.yesDelete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
