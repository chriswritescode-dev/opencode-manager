import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo } from '@/api/types'
import { openCodeLocationQueryOptions } from '@/lib/openCodeLocation'
import { parseRepoRoute } from '@/lib/navigation'

/**
 * Warms the picker's project location on a local repo route so the first session picker open does
 * not serialise the location lookup ahead of the session list. The repo path comes from the already
 * cached repos query, and the prefetch never creates a query observer.
 */
export function useSessionPickerLocationPrefetch(): void {
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const repoId = parseRepoRoute(pathname).repoId

  useEffect(() => {
    if (repoId === null) return
    const repo = queryClient
      .getQueryData<Repo[]>(['repos'])
      ?.find((candidate) => candidate.id === repoId)
    if (!repo) return
    void queryClient.prefetchQuery(
      openCodeLocationQueryOptions(repo.fullPath, LOCAL_OPENCODE_SERVER_ID),
    )
  }, [queryClient, repoId])
}
