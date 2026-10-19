import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScheduleServerTarget } from '@/api/schedules'
import { ServerSchedulesDialog } from './ServerSchedulesDialog'

interface RemoteSchedulesButtonProps {
  serverId: string
  directory: string
}

/**
 * Opens the schedule list for one project on a linked OpenCode server.
 */
export function RemoteSchedulesButton({ serverId, directory }: RemoteSchedulesButtonProps) {
  const [open, setOpen] = useState(false)
  const target: ScheduleServerTarget = { serverId, directory }

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
      <ServerSchedulesDialog open={open} onOpenChange={setOpen} target={target} />
    </>
  )
}
