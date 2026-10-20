import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import { useRepoActivityState } from '@/hooks/useActiveWork'
import type { Repo } from '@/api/types'

/**
 * Shows the repo's activity spinner while a session in it needs input or is running.
 */
export function RepoActivityIndicator({ repo, className }: { repo: Repo; className?: string }) {
  const state = useRepoActivityState(repo)

  return <ActivityStateIndicator state={state} className={className} />
}
