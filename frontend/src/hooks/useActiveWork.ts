import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { sessionQueryOptions, useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useForms, usePermissions } from '@/contexts/EventContext'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import {
  buildActiveWork,
  buildRepoActivityIndex,
  collectActiveRoots,
  repoActivityFromIndex,
  rootSessionID,
  type ActiveWorkGroups,
} from '@/lib/activeWork'
import {
  combineQuerySessions,
  mergeExtraSessions,
} from '@/components/navigation/sidebar-session-tree'
import type { Repo } from '@/api/types'

const ACTIVE_WORK_SESSION_LIMIT = 50

/**
 * The active-work time window in minutes, derived from the user's configured
 * `activityWindowMinutes` with the shared default as a fallback.
 */
export function useActivityWindowMinutes(): number {
  const { preferences } = useSettings()
  return preferences?.activityWindowMinutes ?? DEFAULT_ACTIVITY_WINDOW_MINUTES
}

/** Pending permission and form session ids, merged once per snapshot into a referentially stable list. */
function usePendingInputSessionIDs(): string[] {
  const pendingPermissionSessionIDs = usePermissions().pendingSessionIDs
  const pendingFormSessionIDs = useForms().pendingSessionIDs

  return useMemo(
    () => [...pendingPermissionSessionIDs, ...pendingFormSessionIDs],
    [pendingPermissionSessionIDs, pendingFormSessionIDs],
  )
}

/**
 * Distinct active roots for a badge: needs-input roots and running roots that are not also
 * pending input. Reads only the session-status store and the pending queues, with no network.
 */
export function useActiveWorkCounts(): { needsInput: number; running: number } {
  const statuses = useSessionStatus((state) => state.statuses)
  const parents = useSessionStatus((state) => state.parents)
  const runningShells = useSessionStatus((state) => state.runningShells)
  const pendingInputSessionIDs = usePendingInputSessionIDs()

  return useMemo(() => {
    const roots = collectActiveRoots({ statuses, parents, runningShells, pendingInputSessionIDs })

    let running = 0
    for (const rootID of roots.running) {
      if (!roots.needsInput.has(rootID)) running += 1
    }

    return { needsInput: roots.needsInput.size, running }
  }, [statuses, parents, runningShells, pendingInputSessionIDs])
}

/**
 * Whether a repo has any active session, returned as a primitive so rows only re-render when it
 * changes. Reads only the session-status store and the pending queues, with no network.
 */
export function useRepoActivityState(repo: Repo): 'needs-input' | 'running' | null {
  const pendingInputSessionIDs = usePendingInputSessionIDs()

  return useSessionStatus((state) =>
    repoActivityFromIndex(
      repo,
      buildRepoActivityIndex({
        statuses: state.statuses,
        parents: state.parents,
        runningShells: state.runningShells,
        directories: state.directories,
        pendingInputSessionIDs,
      }),
    ),
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
  const repoDirectories = useMemo(() => repos.map((repo) => repo.fullPath), [repos])

  const {
    data: sessions,
    isLoading: isSessionsLoading,
    isError: isSessionsError,
  } = useSessionsAcrossDirectories(repoDirectories, {
    allDirectories: true,
    limit: ACTIVE_WORK_SESSION_LIMIT,
    includeChildren: true,
  })

  const statuses = useSessionStatus((state) => state.statuses)
  const storeParents = useSessionStatus((state) => state.parents)
  const runningShells = useSessionStatus((state) => state.runningShells)
  const outcomes = useSessionStatus((state) => state.outcomes)
  const sessionDirectories = useSessionStatus((state) => state.directories)
  const pendingInputSessionIDs = usePendingInputSessionIDs()

  const parents = useMemo(() => {
    const merged = new Map<string, string | null>()
    for (const session of sessions) {
      merged.set(session.id, session.parentID ?? null)
    }
    for (const [sessionID, parentID] of storeParents) {
      if (!merged.has(sessionID)) merged.set(sessionID, parentID)
    }
    return merged
  }, [sessions, storeParents])

  const roots = useMemo(
    () => collectActiveRoots({ statuses, parents, runningShells, pendingInputSessionIDs }),
    [statuses, parents, runningShells, pendingInputSessionIDs],
  )

  const listedSessionIDs = useMemo(
    () => new Set(sessions.map((session) => session.id)),
    [sessions],
  )

  const missingRootIDs = useMemo(() => {
    const ids = new Set<string>()
    const windowStart = Date.now() - windowMs
    for (const session of sessions) {
      if (session.time.updated < windowStart) continue
      const rootID = rootSessionID(session.id, parents)
      if (!listedSessionIDs.has(rootID)) ids.add(rootID)
    }
    for (const sessionID of roots.needsInput) {
      if (!listedSessionIDs.has(sessionID)) ids.add(sessionID)
    }
    for (const sessionID of roots.running) {
      if (!listedSessionIDs.has(sessionID)) ids.add(sessionID)
    }
    return [...ids]
  }, [sessions, parents, listedSessionIDs, roots, windowMs])

  const fetchedSessions = useQueries({
    queries: missingRootIDs.map((sessionID) =>
      sessionQueryOptions(sessionID, sessionDirectories.get(sessionID)),
    ),
    combine: combineQuerySessions,
  })

  const mergedSessions = useMemo(
    () => mergeExtraSessions(sessions, fetchedSessions),
    [sessions, fetchedSessions],
  )

  const groups = useMemo(
    () =>
      buildActiveWork({
        now: Date.now(),
        windowMs,
        repos,
        sessions: mergedSessions,
        parents,
        roots,
        outcomes,
      }),
    [windowMs, repos, mergedSessions, parents, roots, outcomes],
  )

  return {
    groups,
    isLoading: isReposLoading || isSessionsLoading,
    isError: isSessionsError,
  }
}
