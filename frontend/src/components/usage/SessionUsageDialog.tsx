import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SessionUsageContent } from './SessionUsageContent'

interface SessionUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
}

export function SessionUsageDialog({ open, onOpenChange, sessionId }: SessionUsageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        mobileFullscreen
        className="sm:fixed sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[min(560px,calc(100vw-2rem))] sm:max-w-[560px] sm:h-auto sm:max-h-[80vh] flex flex-col gap-0 pb-safe"
      >
        <DialogHeader className="shrink-0 px-4 pb-2 pt-4 sm:px-6 sm:pb-3 sm:pt-6">
          <DialogTitle>Session usage</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4">
          {open && <SessionUsageContent sessionId={sessionId} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
