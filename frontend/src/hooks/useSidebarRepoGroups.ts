import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listRepos } from '@/api/repos'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useSessionPins } from '@/hooks/useSessionPins'
import { buildPinnedSessionKeys } from '@/lib/sessionKey'
import type { Repo } from '@/api/types'
import {
  SIDEBAR_SESSIONS_PER_REPO,
  buildSidebarRepoGroups,
  selectNavigableRepos,
  type SidebarRepoGroup,
} from '@/components/navigation/sidebar-session-tree'

export function useSidebarRepoGroups(input: {
  repos: Repo[]
  search?: string
}): { groups: SidebarRepoGroup[]; isLoading: boolean; isError: boolean } {
  const { repos, search } = input

  const directories = useMemo(() => repos.map((repo) => repo.fullPath), [repos])

  const { data: sessions, isLoading, isError } = useSessionsAcrossDirectories(directories, {
    search,
    limit: SIDEBAR_SESSIONS_PER_REPO,
  })

  const { data: sessionPins } = useSessionPins()
  const pinnedKeys = useMemo(() => buildPinnedSessionKeys(sessionPins ?? []), [sessionPins])

  const groups = useMemo(
    () => buildSidebarRepoGroups({ repos, sessions, pinnedKeys, now: Date.now() }),
    [repos, sessions, pinnedKeys],
  )

  return { groups, isLoading, isError }
}

export function useNavigableRepos(enabled = true): { repos: Repo[]; isLoading: boolean; refetch: () => void } {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['repos'], queryFn: listRepos, enabled })
  const repos = useMemo(() => selectNavigableRepos(data ?? []), [data])
  return { repos, isLoading, refetch: () => { void refetch() } }
}
