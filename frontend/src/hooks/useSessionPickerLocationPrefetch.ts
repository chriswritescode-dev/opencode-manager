import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { openCodeLocationQueryOptions } from '@/lib/openCodeLocation'
import { parseRepoRoute } from '@/lib/navigation'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'

/**
 * Warms the picker's project location on a local repo route so the first session picker open does
 * not serialise the location lookup ahead of the session list. The repo path comes from the repos
 * query the repo worktrees provider already observes, so a route restored before that query settles
 * still prefetches once the repo data arrives. The prefetch never creates a query observer.
 */
export function useSessionPickerLocationPrefetch(): void {
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const { repos } = useNavigableRepos()
  const repoId = parseRepoRoute(pathname).repoId
  const repoPath = repos.find((repo) => repo.id === repoId)?.fullPath

  useEffect(() => {
    if (repoPath === undefined) return
    void queryClient.prefetchQuery(
      openCodeLocationQueryOptions(repoPath, LOCAL_OPENCODE_SERVER_ID),
    )
  }, [queryClient, repoPath])
}
