import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScheduleReportsBadge } from '@/components/notifications/ScheduleReportsBadge'
import { useUnreadScheduleRuns } from '@/hooks/useSchedules'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'

export function SessionMoreButton() {
  const { open } = useMobileTabBar()
  const { data } = useUnreadScheduleRuns()
  const total = data?.total ?? 0
  const failed = data?.failed ?? 0

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => open('more')}
      className="relative md:hidden h-10 w-10 p-0 text-foreground border-border hover:bg-accent"
      aria-label={total > 0 ? `More, ${total} unread reports` : 'More'}
    >
      <MoreVertical className="w-5 h-5" />
      <ScheduleReportsBadge total={total} failed={failed} />
    </Button>
  )
}
