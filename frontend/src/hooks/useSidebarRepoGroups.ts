import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { listRepos } from '@/api/repos'
import { sessionQueryOptions, useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useSessionPins } from '@/hooks/useSessionPins'
import { buildPinnedSessionKeys, buildSessionKey, getSessionKey } from '@/lib/sessionKey'
import type { Repo, Session } from '@/api/types'
import {
  SIDEBAR_SESSIONS_PER_REPO,
  buildSidebarRepoGroups,
  selectNavigableRepos,
  type SidebarRepoGroup,
} from '@/components/navigation/sidebar-session-tree'

const combinePinnedSessions = (results: Array<{ data?: Session }>): Session[] =>
  results.flatMap((result) => (result.data ? [result.data] : []))

const mergeSessions = (sessions: Session[], pinnedSessions: Session[]): Session[] => {
  if (pinnedSessions.length === 0) return sessions
  const seen = new Set(sessions.map((session) => session.id))
  const extras: Session[] = []
  for (const session of pinnedSessions) {
    if (seen.has(session.id)) continue
    seen.add(session.id)
    extras.push(session)
  }
  return extras.length === 0 ? sessions : [...sessions, ...extras]
}

export function useSidebarRepoGroups(input: {
  repos: Repo[]
  search?: string
}): { groups: SidebarRepoGroup[]; isLoading: boolean; isError: boolean; hasMore: boolean } {
  const { repos, search } = input

  const directories = useMemo(() => repos.map((repo) => repo.fullPath), [repos])

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
    combine: combinePinnedSessions,
  })

  const mergedSessions = useMemo(
    () => mergeSessions(sessions, pinnedSessions),
    [sessions, pinnedSessions],
  )

  const groups = useMemo(
    () => buildSidebarRepoGroups({ repos, sessions: mergedSessions, pinnedKeys, now: Date.now() }),
    [repos, mergedSessions, pinnedKeys],
  )

  return { groups, isLoading, isError, hasMore: Boolean(hasNextPage) }
}

export function useNavigableRepos(enabled = true): { repos: Repo[]; isLoading: boolean; refetch: () => void } {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['repos'], queryFn: listRepos, enabled })
  const repos = useMemo(() => selectNavigableRepos(data ?? []), [data])
  return { repos, isLoading, refetch: () => { void refetch() } }
}
