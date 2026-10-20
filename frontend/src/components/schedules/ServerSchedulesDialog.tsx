import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ScheduleServerTarget } from '@/api/schedules'
import { ServerSchedulesContent } from './ServerSchedulesContent'

interface ServerSchedulesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ScheduleServerTarget | null
}

export function ServerSchedulesDialog({ open, onOpenChange, target }: ServerSchedulesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh max-h-dvh w-full max-w-5xl flex-col gap-0 overflow-hidden border-border bg-background p-0 shadow-lg sm:h-[min(88vh,860px)] sm:max-h-[88vh] sm:max-w-[92vw]">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-3 py-4 sm:px-6">
          <DialogTitle>Schedules</DialogTitle>
          <DialogDescription className="mt-0 truncate font-mono text-xs">
            {target?.directory ?? ''}
          </DialogDescription>
        </DialogHeader>
        {target ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-3 sm:px-6">
            <ServerSchedulesContent target={target} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
