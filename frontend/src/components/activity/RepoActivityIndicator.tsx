import { ActivitySpinner } from '@/components/ui/activity-spinner'
import { useRepoActivityState } from '@/hooks/useActiveWork'
import { cn } from '@/lib/utils'
import type { Repo } from '@/api/types'

/**
 * Renders nothing unless a session in the repo is active, then shows the braille spinner in the
 * state colour (info while running, warning when a session needs input).
 */
export function RepoActivityIndicator({ repo, className }: { repo: Repo; className?: string }) {
  const state = useRepoActivityState(repo)
  if (state === null) return null

  return (
    <span
      role="img"
      aria-label={state === 'needs-input' ? 'Session needs input' : 'Sessions running'}
      className={cn('inline-flex shrink-0 items-center', state === 'needs-input' ? 'text-warning' : 'text-info', className)}
    >
      <ActivitySpinner />
    </span>
  )
}
