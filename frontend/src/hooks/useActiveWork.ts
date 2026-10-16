import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { sessionQueryOptions, useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useForms, usePermissions } from '@/contexts/EventContext'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import { buildActiveWork, collectActiveRoots, activeRepoState, type ActiveWorkGroups } from '@/lib/activeWork'
import type { Repo, Session } from '@/api/types'

const ACTIVE_WORK_SESSION_LIMIT = 50
const MS_PER_MINUTE = 60_000

/**
 * The active-work time window in milliseconds, derived from the user's configured
 * `activityWindowMinutes` with the shared default as a fallback.
 */
export function useActivityWindowMs(): number {
  const { preferences } = useSettings()
  const minutes = preferences?.activityWindowMinutes ?? DEFAULT_ACTIVITY_WINDOW_MINUTES
  return minutes * MS_PER_MINUTE
}

const combineSessions = (results: Array<{ data?: Session }>): Session[] =>
  results.flatMap((result) => (result.data ? [result.data] : []))

/**
 * Distinct active roots for a badge: needs-input roots and running roots that are not also
 * pending input. Reads only the session-status store and the pending queues, with no network.
 */
export function useActiveWorkCounts(): { needsInput: number; running: number } {
  const statuses = useSessionStatus((state) => state.statuses)
  const parents = useSessionStatus((state) => state.parents)
  const runningShells = useSessionStatus((state) => state.runningShells)
  const pendingPermissionSessionIDs = usePermissions().pendingSessionIDs
  const pendingFormSessionIDs = useForms().pendingSessionIDs

  return useMemo(() => {
    const pendingInputSessionIDs = new Set([
      ...pendingPermissionSessionIDs,
      ...pendingFormSessionIDs,
    ])
    const roots = collectActiveRoots({ statuses, parents, runningShells, pendingInputSessionIDs })

    let running = 0
    for (const rootID of roots.running) {
      if (!roots.needsInput.has(rootID)) running += 1
    }

    return { needsInput: roots.needsInput.size, running }
  }, [statuses, parents, runningShells, pendingPermissionSessionIDs, pendingFormSessionIDs])
}

/**
 * Whether a repo has any active session, returned as a primitive so rows only re-render when it
 * changes. Reads only the session-status store and the pending queues, with no network.
 */
export function useRepoActivityState(repo: Repo): 'needs-input' | 'running' | null {
  const pendingPermissionSessionIDs = usePermissions().pendingSessionIDs
  const pendingFormSessionIDs = useForms().pendingSessionIDs
  const pendingInputSessionIDs = useMemo(
    () => [...pendingPermissionSessionIDs, ...pendingFormSessionIDs],
    [pendingPermissionSessionIDs, pendingFormSessionIDs],
  )

  return useSessionStatus((state) =>
    activeRepoState({
      repo,
      statuses: state.statuses,
      parents: state.parents,
      runningShells: state.runningShells,
      directories: state.directories,
      pendingInputSessionIDs,
    }),
  )
}

/**
 * The full active-work list. Performs network reads, so it must only be used by components that
 * are mounted while visible (the session picker fetches only while open).
 */
export function useActiveWork(windowMs: number): {
  groups: ActiveWorkGroups
  isLoading: boolean
  isError: boolean
} {
  const { repos, isLoading: isReposLoading } = useNavigableRepos()
  const directories = useMemo(() => repos.map((repo) => repo.fullPath), [repos])

  const {
    data: sessions,
    isLoading: isSessionsLoading,
    isError: isSessionsError,
  } = useSessionsAcrossDirectories(directories, {
    allDirectories: true,
    limit: ACTIVE_WORK_SESSION_LIMIT,
  })

  const statuses = useSessionStatus((state) => state.statuses)
  const parents = useSessionStatus((state) => state.parents)
  const runningShells = useSessionStatus((state) => state.runningShells)
  const outcomes = useSessionStatus((state) => state.outcomes)
  const pendingPermissionSessionIDs = usePermissions().pendingSessionIDs
  const pendingFormSessionIDs = useForms().pendingSessionIDs

  const roots = useMemo(
    () =>
      collectActiveRoots({
        statuses,
        parents,
        runningShells,
        pendingInputSessionIDs: [...pendingPermissionSessionIDs, ...pendingFormSessionIDs],
      }),
    [statuses, parents, runningShells, pendingPermissionSessionIDs, pendingFormSessionIDs],
  )

  const listedSessionIDs = useMemo(
    () => new Set(sessions.map((session) => session.id)),
    [sessions],
  )

  const missingRootIDs = useMemo(() => {
    const ids = new Set<string>()
    for (const sessionID of roots.needsInput) {
      if (!listedSessionIDs.has(sessionID)) ids.add(sessionID)
    }
    for (const sessionID of roots.running) {
      if (!listedSessionIDs.has(sessionID)) ids.add(sessionID)
    }
    return [...ids]
  }, [roots, listedSessionIDs])

  const fetchedSessions = useQueries({
    queries: missingRootIDs.map((sessionID) => sessionQueryOptions(sessionID)),
    combine: combineSessions,
  })

  const mergedSessions = useMemo(() => {
    if (fetchedSessions.length === 0) return sessions
    const seen = new Set(sessions.map((session) => session.id))
    const extras = fetchedSessions.filter((session) => !seen.has(session.id))
    return extras.length === 0 ? sessions : [...sessions, ...extras]
  }, [sessions, fetchedSessions])

  const groups = useMemo(
    () =>
      buildActiveWork({
        now: Date.now(),
        windowMs,
        repos,
        sessions: mergedSessions,
        roots,
        outcomes,
      }),
    [windowMs, repos, mergedSessions, roots, outcomes],
  )

  return {
    groups,
    isLoading: isReposLoading || isSessionsLoading,
    isError: isSessionsError,
  }
}
