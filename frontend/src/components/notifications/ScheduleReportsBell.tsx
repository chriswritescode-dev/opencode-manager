import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { NotificationsBadge } from '@/components/notifications/NotificationsBadge'
import { ScheduleReportsList } from '@/components/notifications/ScheduleReportsList'
import { useMarkAllScheduleRunsViewed, useUnreadScheduleRuns } from '@/hooks/useSchedules'

export function ScheduleReportsBell() {
  const { data } = useUnreadScheduleRuns()
  const markAllViewed = useMarkAllScheduleRunsViewed()
  const [open, setOpen] = useState(false)

  const runs = data?.runs ?? []
  const total = data?.total ?? 0
  const failed = data?.failed ?? 0

  const markAllRead = () => {
    markAllViewed.mutate()
  }

  if (total === 0 && !open) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Reports, ${total} unread`}
          className="relative hidden h-10 w-10 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground sm:h-8 sm:w-8 md:inline-flex"
        >
          <Inbox className="h-5 w-5 sm:h-4 sm:w-4" />
          <NotificationsBadge count={total} destructive={failed > 0} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <ScheduleReportsList
          runs={runs}
          total={total}
          onMarkAllRead={markAllRead}
          markAllPending={markAllViewed.isPending}
          onNavigate={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
