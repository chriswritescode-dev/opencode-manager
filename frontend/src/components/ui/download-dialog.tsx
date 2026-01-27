import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, Loader2, Archive } from 'lucide-react'

interface DownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: () => Promise<void>
  title: string
  description: string
  itemName: string
}

export function DownloadDialog({
  open,
  onOpenChange,
  onDownload,
  title,
  description,
  itemName,
}: DownloadDialogProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)

  const handleConfirm = async () => {
    setIsConfirmed(true)
    setIsDownloading(true)
    try {
      await onDownload()
    } catch (error) {
      console.error('Download failed:', error)
    } finally {
      setIsDownloading(false)
      onOpenChange(false)
      setIsConfirmed(false)
    }
  }

  const handleCancel = () => {
    if (isDownloading) return
    onOpenChange(false)
    setIsConfirmed(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDownloading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Archive className="w-5 h-5" />
            )}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {!isDownloading && (
            <DialogDescription>
              {description}
            </DialogDescription>
          )}
          
          <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
            <Archive className="w-8 h-8 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{isConfirmed ? 'Processing...' : itemName}</p>
              {isDownloading && (
                <p className="text-xs text-muted-foreground mt-1">
                  Creating ZIP archive, please wait...
                </p>
              )}
            </div>
          </div>

          {isDownloading && (
            <div className="space-y-2">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary animate-progress w-full" />
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Download starting...
              </p>
            </div>
          )}
        </div>
        <DialogFooter >
          {!isDownloading && !isConfirmed && (
            <div className='flex gap-2 w-full'>
              <Button variant="outline" onClick={handleCancel} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleConfirm} className="gap-2 flex-1">
                <Download className="w-4 h-4" />
                Download
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
