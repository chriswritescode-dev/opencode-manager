import { cn } from '@/lib/utils'

interface ScheduleReportsBadgeProps {
  total: number
  failed: number
  className?: string
}

export function ScheduleReportsBadge({ total, failed, className }: ScheduleReportsBadgeProps) {
  if (total <= 0) return null

  return (
    <span
      className={cn(
        'absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground',
        failed > 0 ? 'bg-destructive' : 'bg-primary',
        className,
      )}
    >
      {total > 9 ? '9+' : total}
    </span>
  )
}
