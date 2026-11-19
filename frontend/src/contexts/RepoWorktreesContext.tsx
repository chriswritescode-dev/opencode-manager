import type { ReactNode } from 'react'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useRepoWorktrees } from '@/hooks/useRepoWorktrees'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { buildRepoActivityIndex, hasUnmatchedActiveDirectory } from '@/lib/activeWork'
import { RepoWorktreesContext, usePendingInputSessionIDs } from './repo-worktrees-context'

export function RepoWorktreesProvider({ children }: { children: ReactNode }) {
  const { repos } = useNavigableRepos()
  const pendingInputSessionIDs = usePendingInputSessionIDs()

  const enabled = useSessionStatus((state) =>
    hasUnmatchedActiveDirectory(
      buildRepoActivityIndex({
        statuses: state.statuses,
        parents: state.parents,
        runningShells: state.runningShells,
        directories: state.directories,
        pendingInputSessionIDs,
      }),
      repos,
    ),
  )

  const { worktrees } = useRepoWorktrees(repos, enabled)

  return <RepoWorktreesContext.Provider value={worktrees}>{children}</RepoWorktreesContext.Provider>
}
