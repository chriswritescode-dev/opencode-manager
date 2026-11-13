import { createContext, useContext, useMemo } from 'react'
import { useForms, usePermissions } from '@/contexts/event-context'
import type { ActiveWorktree } from '@/lib/activeWork'

const EMPTY_WORKTREES: ActiveWorktree[] = []

export const RepoWorktreesContext = createContext<ActiveWorktree[]>(EMPTY_WORKTREES)

export function usePendingInputSessionIDs(): string[] {
  const pendingPermissionSessionIDs = usePermissions().pendingSessionIDs
  const pendingFormSessionIDs = useForms().pendingSessionIDs

  return useMemo(
    () => [...pendingPermissionSessionIDs, ...pendingFormSessionIDs],
    [pendingPermissionSessionIDs, pendingFormSessionIDs],
  )
}

export function useRepoWorktreeList(): ActiveWorktree[] {
  return useContext(RepoWorktreesContext)
}
