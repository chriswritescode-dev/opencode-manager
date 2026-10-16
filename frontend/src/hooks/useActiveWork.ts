import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { sessionQueryOptions, useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { usePendingInputSessionIDs, useRepoWorktreeList } from '@/contexts/RepoWorktreesContext'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import { useRepoWorktrees } from '@/hooks/useRepoWorktrees'
import {
  MS_PER_MINUTE,
  buildActiveWork,
  buildRepoActivityIndex,
  collectActiveRoots,
  needsWorktreeLookup,
  repoActivityFromIndex,
  rootSessionID,
  type ActiveWorkGroups,
} from '@/lib/activeWork'
import { combineQuerySessions, mergeExtraSessions } from '@/components/navigation/sidebar-session-tree'
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
  const worktrees = useRepoWorktreeList()

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
      worktrees,
    ),
  )
}

/**
 * Walks a session's ancestor chain through the shared session cache, returning each link as
 * `[sessionID, parentID]` from the session down to its root. Stops at a root, a missing session,
 * or a cycle. Reusing `sessionQueryOptions` keeps these reads on the shared session cache.
 */
async function fetchAncestorLinks(
  queryClient: QueryClient,
  sessionID: string,
  directories: ReadonlyMap<string, string>,
): Promise<Array<[string, string | null]>> {
  const links: Array<[string, string | null]> = []
  const visited = new Set<string>()
  let currentID: string | null | undefined = sessionID

  while (currentID && !visited.has(currentID)) {
    visited.add(currentID)
    const session: SessionInfo = await queryClient.fetchQuery(
      sessionQueryOptions(currentID, directories.get(currentID)),
    )
    const parentID: string | null = session.parentID ?? null
    links.push([session.id, parentID])
    currentID = parentID
  }

  return links
}

/** Flattens the resolved ancestor links from each query result, dropping unresolved queries. */
const combineAncestorLinks = (
  results: Array<{ data?: Array<[string, string | null]> }>,
): Array<[string, string | null]> => results.flatMap((result) => result.data ?? [])

/**
 * The full active-work list. Performs network reads, so it must only be used by components that
 * are mounted while visible (the session picker fetches only while open).
 */
export function useActiveWork(windowMs: number): {
  groups: ActiveWorkGroups
  isLoading: boolean
  isError: boolean
} {
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => Date.now())
  const { repos, isLoading: isReposLoading } = useNavigableRepos()
  const repoDirectories = useMemo(() => repos.map((repo) => repo.fullPath), [repos])

  const {
    data: sessions,
    isLoading: isSessionsLoading,
    isError: isSessionsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useSessionsAcrossDirectories(repoDirectories, {
    allDirectories: true,
    limit: ACTIVE_WORK_SESSION_LIMIT,
    includeChildren: true,
  })

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), MS_PER_MINUTE)
    return () => clearInterval(interval)
  }, [])

  const oldestLoadedUpdatedAt = sessions.at(-1)?.time.updated

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    if (oldestLoadedUpdatedAt === undefined || oldestLoadedUpdatedAt < now - windowMs) return
    void fetchNextPage()
  }, [
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    oldestLoadedUpdatedAt,
    now,
    windowMs,
    fetchNextPage,
  ])

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
    const windowStart = now - windowMs
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
  }, [sessions, parents, listedSessionIDs, roots, windowMs, now])

  const ancestorLinks = useQueries({
    queries: missingRootIDs.map((sessionID) => ({
      queryKey: ['opencode', 'session-ancestry', sessionID] as const,
      queryFn: () => fetchAncestorLinks(queryClient, sessionID, sessionDirectories),
      staleTime: Infinity,
    })),
    combine: combineAncestorLinks,
  })

  const resolvedParents = useMemo(() => {
    const merged = new Map(parents)
    for (const [sessionID, parentID] of ancestorLinks) {
      merged.set(sessionID, parentID)
    }
    return merged
  }, [parents, ancestorLinks])

  const resolvedRoots = useMemo(
    () => collectActiveRoots({ statuses, parents: resolvedParents, runningShells, pendingInputSessionIDs }),
    [statuses, resolvedParents, runningShells, pendingInputSessionIDs],
  )

  const backfillRootIDs = useMemo(() => {
    const ids = new Set<string>()
    for (const sessionID of missingRootIDs) {
      const rootID = rootSessionID(sessionID, resolvedParents)
      if (!listedSessionIDs.has(rootID)) ids.add(rootID)
    }
    return [...ids]
  }, [missingRootIDs, resolvedParents, listedSessionIDs])

  const fetchedSessions = useQueries({
    queries: backfillRootIDs.map((sessionID) =>
      sessionQueryOptions(sessionID, sessionDirectories.get(sessionID)),
    ),
    combine: combineQuerySessions,
  })

  const mergedSessions = useMemo(
    () => mergeExtraSessions(sessions, fetchedSessions),
    [sessions, fetchedSessions],
  )

  const needsLookup = useMemo(
    () =>
      needsWorktreeLookup({
        now,
        windowMs,
        repos,
        sessions: mergedSessions,
        parents: resolvedParents,
        roots: resolvedRoots,
      }),
    [now, windowMs, repos, mergedSessions, resolvedParents, resolvedRoots],
  )

  const {
    worktrees,
    isLoading: isWorktreesLoading,
    isError: isWorktreesError,
  } = useRepoWorktrees(repos, needsLookup)

  const groups = useMemo(
    () =>
      buildActiveWork({
        now,
        windowMs,
        repos,
        sessions: mergedSessions,
        parents: resolvedParents,
        roots: resolvedRoots,
        outcomes,
        worktrees,
      }),
    [now, windowMs, repos, mergedSessions, resolvedParents, resolvedRoots, outcomes, worktrees],
  )

  return {
    groups,
    isLoading: isReposLoading || isSessionsLoading || isWorktreesLoading,
    isError: isSessionsError || isWorktreesError,
  }
}
