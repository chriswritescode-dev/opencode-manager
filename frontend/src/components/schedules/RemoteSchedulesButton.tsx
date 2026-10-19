import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScheduleServerTarget } from '@/api/schedules'
import { ServerSchedulesDialog } from './ServerSchedulesDialog'

interface RemoteSchedulesDialogProps {
  serverId: string
  directory: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The schedule list for one project on a linked OpenCode server, controlled by its caller.
 */
export function RemoteSchedulesDialog({ serverId, directory, open, onOpenChange }: RemoteSchedulesDialogProps) {
  const target: ScheduleServerTarget = { serverId, directory }

  return <ServerSchedulesDialog open={open} onOpenChange={onOpenChange} target={target} />
}

/**
 * Opens the schedule list for one project on a linked OpenCode server.
 */
export function RemoteSchedulesButton({ serverId, directory }: { serverId: string; directory: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="shrink-0"
        aria-label={`Schedules for ${directory}`}
      >
        <CalendarClock className="mr-1 h-4 w-4" />
        <span className="hidden sm:inline">Schedules</span>
      </Button>
      <RemoteSchedulesDialog
        serverId={serverId}
        directory={directory}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
