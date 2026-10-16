/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useForms, usePermissions } from '@/contexts/EventContext'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useRepoWorktrees } from '@/hooks/useRepoWorktrees'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import {
  buildRepoActivityIndex,
  hasUnmatchedActiveDirectory,
  type ActiveWorktree,
} from '@/lib/activeWork'

const EMPTY_WORKTREES: ActiveWorktree[] = []

const RepoWorktreesContext = createContext<ActiveWorktree[]>(EMPTY_WORKTREES)

/** Pending permission and form session ids, merged once per snapshot into a referentially stable list. */
export function usePendingInputSessionIDs(): string[] {
  const pendingPermissionSessionIDs = usePermissions().pendingSessionIDs
  const pendingFormSessionIDs = useForms().pendingSessionIDs

  return useMemo(
    () => [...pendingPermissionSessionIDs, ...pendingFormSessionIDs],
    [pendingPermissionSessionIDs, pendingFormSessionIDs],
  )
}

/**
 * Discovers the repos' worktrees once for the whole app and shares them, so per-row repo badges can
 * resolve a session running in a worktree to its owning repo without each row fetching. The worktree
 * lookup only runs while some active session sits in a directory that matches no repo.
 */
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

/** The worktrees discovered for the app's repos, empty outside the provider. */
export function useRepoWorktreeList(): ActiveWorktree[] {
  return useContext(RepoWorktreesContext)
}
