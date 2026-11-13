import { ActivitySpinner } from '@/components/ui/activity-spinner'
import { cn } from '@/lib/utils'

export function ActivityStateIndicator({
  state,
  className,
}: {
  state: 'needs-input' | 'running' | null
  className?: string
}) {
  if (state === null) return null

  return (
    <span
      role="img"
      aria-label={state === 'needs-input' ? 'Session needs input' : 'Sessions running'}
      className={cn(
        'inline-flex shrink-0 items-center',
        state === 'needs-input' ? 'text-warning' : 'text-info',
        className,
      )}
    >
      <ActivitySpinner />
    </span>
  )
}
