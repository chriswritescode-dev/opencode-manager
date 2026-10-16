import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { listRepos } from '@/api/repos'
import { sessionQueryOptions, useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useSessionPins } from '@/hooks/useSessionPins'
import { buildPinnedSessionKeys, buildSessionKey, getSessionKey } from '@/lib/sessionKey'
import type { Repo } from '@/api/types'
import type { ActiveWorktree } from '@/lib/activeWork'
import {
  SIDEBAR_SESSIONS_PER_REPO,
  buildSidebarRepoGroups,
  combineQuerySessions,
  mergeExtraSessions,
  selectNavigableRepos,
  type SidebarRepoGroup,
} from '@/components/navigation/sidebar-session-tree'

export function useSidebarRepoGroups(input: {
  repos: Repo[]
  search?: string
  worktrees?: ReadonlyArray<ActiveWorktree>
}): { groups: SidebarRepoGroup[]; isLoading: boolean; isError: boolean; hasMore: boolean } {
  const { repos, search, worktrees } = input

  const directories = useMemo(
    () => [
      ...repos.map((repo) => repo.fullPath),
      ...(worktrees ?? []).map((worktree) => worktree.directory),
    ],
    [repos, worktrees],
  )

  const { data: sessions, isLoading, isError, hasNextPage } = useSessionsAcrossDirectories(directories, {
    search,
    limit: SIDEBAR_SESSIONS_PER_REPO,
  })

  const { data: sessionPins } = useSessionPins()
  const pinnedKeys = useMemo(() => buildPinnedSessionKeys(sessionPins ?? []), [sessionPins])

  const missingPins = useMemo(() => {
    if (search) return []
    const repoDirectories = new Set(directories)
    const fetchedKeys = new Set(sessions.map(getSessionKey))
    return (sessionPins ?? []).filter(
      (pin) =>
        repoDirectories.has(pin.directory) &&
        !fetchedKeys.has(buildSessionKey(pin.directory, pin.sessionId)),
    )
  }, [directories, search, sessionPins, sessions])

  const pinnedSessions = useQueries({
    queries: missingPins.map((pin) => sessionQueryOptions(pin.sessionId, pin.directory)),
    combine: combineQuerySessions,
  })

  const mergedSessions = useMemo(
    () => mergeExtraSessions(sessions, pinnedSessions),
    [sessions, pinnedSessions],
  )

  const groups = useMemo(
    () =>
      buildSidebarRepoGroups({
        repos,
        sessions: mergedSessions,
        pinnedKeys,
        now: Date.now(),
        worktrees,
      }),
    [repos, mergedSessions, pinnedKeys, worktrees],
  )

  return { groups, isLoading, isError, hasMore: Boolean(hasNextPage) }
}

export function useNavigableRepos(enabled = true): { repos: Repo[]; isLoading: boolean; refetch: () => void } {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['repos'], queryFn: listRepos, enabled })
  const repos = useMemo(() => selectNavigableRepos(data ?? []), [data])
  return { repos, isLoading, refetch: () => { void refetch() } }
}
