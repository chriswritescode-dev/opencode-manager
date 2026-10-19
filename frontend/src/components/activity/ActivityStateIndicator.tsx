import { ActivitySpinner } from '@/components/ui/activity-spinner'
import { cn } from '@/lib/utils'

/**
 * Renders nothing unless a repo or linked server has an active session, then shows the braille
 * spinner in the state colour (info while running, warning when a session needs input).
 */
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
