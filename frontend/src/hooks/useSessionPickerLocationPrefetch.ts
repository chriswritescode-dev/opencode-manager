import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { openCodeLocationQueryOptions } from '@/lib/openCodeLocation'
import { parseRepoRoute } from '@/lib/navigation'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'

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
