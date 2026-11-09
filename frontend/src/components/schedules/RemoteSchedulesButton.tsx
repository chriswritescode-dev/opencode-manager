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
