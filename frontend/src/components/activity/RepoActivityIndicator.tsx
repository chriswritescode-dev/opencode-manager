import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import { useRepoActivityState } from '@/hooks/useActiveWork'
import type { Repo } from '@/api/types'

export function RepoActivityIndicator({ repo, className }: { repo: Repo; className?: string }) {
  const state = useRepoActivityState(repo)

  return <ActivityStateIndicator state={state} className={className} />
}
