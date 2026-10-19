import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { listSessionPage } from '@/api/opencode'
import { sessionQueryOptions, useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { usePendingInputSessionIDs, useRepoWorktreeList } from '@/contexts/RepoWorktreesContext'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { serverScopedKey } from '@/lib/serverScope'
import { activeWorkSessionsQueryKey } from '@/lib/queryInvalidation'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import { useRepoWorktrees } from '@/hooks/useRepoWorktrees'
import {
  MS_PER_MINUTE,
  buildActiveWork,
  buildRepoActivityIndex,
  buildServerActivityIndex,
  collectActiveRoots,
  needsWorktreeLookup,
  repoActivityFromIndex,
  rootSessionID,
  serverActivityFromIndex,
  sessionScopeOfDirectory,
  type ActiveWorkGroups,
} from '@/lib/activeWork'
import { combineQuerySessions, mergeExtraSessions } from '@/components/navigation/sidebar-session-tree'
import type { Repo } from '@/api/types'

const ACTIVE_WORK_SESSION_LIMIT = 50
const ACTIVE_WORK_SESSIONS_STALE_MS = 10000

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
 * Whether a linked server has any active session, returned as a primitive so rows only re-render
 * when it changes. Reads only the session-status store and the pending queues, with no network.
 */
export function useServerActivityState(serverId: string): 'needs-input' | 'running' | null {
  const pendingInputSessionIDs = usePendingInputSessionIDs()

  return useSessionStatus((state) =>
    serverActivityFromIndex(
      serverId,
      buildServerActivityIndex({
        statuses: state.statuses,
        parents: state.parents,
        runningShells: state.runningShells,
        directories: state.directories,
        sessionServers: state.sessionServers,
        pendingInputSessionIDs,
      }),
    ),
  )
}

interface SessionScope {
  serverId: string
  directory: string | undefined
}

/**
 * The owning server and plain directory of a session from the status store. A server-keyed
 * directory names its owner, otherwise the session-server index does; everything else is local.
 */
function sessionScopeOf(
  sessionID: string,
  directories: ReadonlyMap<string, string>,
  sessionServers: ReadonlyMap<string, string>,
): SessionScope {
  const scope = sessionScopeOfDirectory(directories.get(sessionID), sessionServers.get(sessionID))
  return { serverId: scope.serverId, directory: scope.directory ?? undefined }
}

/**
 * Walks a session's ancestor chain through the shared session cache, returning each link as
 * `[sessionID, parentID]` from the session down to its root. Stops at a root, a missing session,
 * or a cycle. Remote sessions are read through their owning server, never the local API. Reusing
 * `sessionQueryOptions` keeps these reads on the shared session cache.
 */
async function fetchAncestorLinks(
  queryClient: QueryClient,
  sessionID: string,
  directories: ReadonlyMap<string, string>,
  sessionServers: ReadonlyMap<string, string>,
): Promise<Array<[string, string | null]>> {
  const links: Array<[string, string | null]> = []
  const visited = new Set<string>()
  const origin = sessionScopeOf(sessionID, directories, sessionServers)
  let currentID: string | null | undefined = sessionID

  while (currentID && !visited.has(currentID)) {
    visited.add(currentID)
    const scope = sessionScopeOf(currentID, directories, sessionServers)
    const directory = scope.serverId === origin.serverId ? scope.directory : undefined
    const session: SessionInfo = await queryClient.fetchQuery(
      sessionQueryOptions(currentID, directory, origin.serverId),
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

interface ServerSessionPage {
  serverId: string
  sessions: SessionInfo[]
}

/**
 * Pairs each server's active-work page with its server id, dropping pages that are empty or failed
 * so one unreachable server never removes the others from the list.
 */
function combineServerSessionPages(
  results: Array<{ data?: SessionInfo[] }>,
  serverIds: ReadonlyArray<string>,
): ServerSessionPage[] {
  return results.flatMap((result, index) => {
    if (!result.data || result.data.length === 0) return []
    return [{ serverId: serverIds[index], sessions: result.data }]
  })
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
    serverId: LOCAL_OPENCODE_SERVER_ID,
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
  const sessionServers = useSessionStatus((state) => state.sessionServers)
  const pendingInputSessionIDs = usePendingInputSessionIDs()

  const { servers } = useOpenCodeServers()
  const remoteServerIds = useMemo(
    () => servers.filter((server) => server.enabled).map((server) => server.id),
    [servers],
  )

  const serverSessionPages = useQueries({
    queries: remoteServerIds.map((serverId) => ({
      queryKey: activeWorkSessionsQueryKey(serverId),
      queryFn: async (): Promise<SessionInfo[]> => {
        const page = await listSessionPage(
          { limit: ACTIVE_WORK_SESSION_LIMIT, order: 'desc', includeChildren: true },
          serverId,
        )
        return page.items
      },
      staleTime: ACTIVE_WORK_SESSIONS_STALE_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    })),
    combine: (results) => combineServerSessionPages(results, remoteServerIds),
  })

  const serverSessions = useMemo(
    () => serverSessionPages.flatMap((page) => page.sessions),
    [serverSessionPages],
  )

  const serverSessionServers = useMemo(() => {
    const owners = new Map<string, string>()
    for (const page of serverSessionPages) {
      for (const session of page.sessions) {
        owners.set(session.id, page.serverId)
        if (session.parentID) owners.set(session.parentID, page.serverId)
      }
    }
    return owners
  }, [serverSessionPages])

  const allSessions = useMemo(
    () => (serverSessions.length === 0 ? sessions : [...sessions, ...serverSessions]),
    [sessions, serverSessions],
  )

  const sessionOwners = useMemo(() => {
    if (serverSessionServers.size === 0) return sessionServers
    const merged = new Map(sessionServers)
    for (const [sessionID, serverId] of serverSessionServers) {
      if (!merged.has(sessionID)) merged.set(sessionID, serverId)
    }
    return merged
  }, [sessionServers, serverSessionServers])

  const parents = useMemo(() => {
    const merged = new Map<string, string | null>()
    for (const session of allSessions) {
      merged.set(session.id, session.parentID ?? null)
    }
    for (const [sessionID, parentID] of storeParents) {
      if (!merged.has(sessionID)) merged.set(sessionID, parentID)
    }
    return merged
  }, [allSessions, storeParents])

  const roots = useMemo(
    () => collectActiveRoots({ statuses, parents, runningShells, pendingInputSessionIDs }),
    [statuses, parents, runningShells, pendingInputSessionIDs],
  )

  const listedSessionIDs = useMemo(
    () => new Set(allSessions.map((session) => session.id)),
    [allSessions],
  )

  const missingRootIDs = useMemo(() => {
    const ids = new Set<string>()
    const windowStart = now - windowMs
    for (const session of allSessions) {
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
  }, [allSessions, parents, listedSessionIDs, roots, windowMs, now])

  const ancestorLinks = useQueries({
    queries: missingRootIDs.map((sessionID) => {
      const { serverId } = sessionScopeOf(sessionID, sessionDirectories, sessionOwners)
      return {
        queryKey: serverScopedKey(['opencode', 'session-ancestry', sessionID], serverId),
        queryFn: () => fetchAncestorLinks(queryClient, sessionID, sessionDirectories, sessionOwners),
        staleTime: Infinity,
      }
    }),
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

  const resolvedSessionServers = useMemo(() => {
    const merged = new Map(sessionOwners)
    for (const [sessionID, serverId] of sessionOwners) {
      const visited = new Set<string>()
      let currentID: string | null | undefined = sessionID
      while (currentID && !visited.has(currentID)) {
        visited.add(currentID)
        merged.set(currentID, serverId)
        currentID = resolvedParents.get(currentID) ?? null
      }
    }
    return merged
  }, [sessionOwners, resolvedParents])

  const hasRemoteRoots = useMemo(
    () =>
      [...resolvedRoots.needsInput, ...resolvedRoots.running].some((sessionID) =>
        resolvedSessionServers.has(sessionID),
      ),
    [resolvedRoots, resolvedSessionServers],
  )

  const hasServerSessions = hasRemoteRoots || serverSessionPages.length > 0

  const serverNames = useMemo(() => {
    if (!hasServerSessions || servers.length === 0) return undefined
    return new Map(servers.map((server) => [server.id, server.name]))
  }, [hasServerSessions, servers])

  const backfillRootIDs = useMemo(() => {
    const ids = new Set<string>()
    for (const sessionID of missingRootIDs) {
      const rootID = rootSessionID(sessionID, resolvedParents)
      if (!listedSessionIDs.has(rootID)) ids.add(rootID)
    }
    return [...ids]
  }, [missingRootIDs, resolvedParents, listedSessionIDs])

  const fetchedSessions = useQueries({
    queries: backfillRootIDs.map((sessionID) => {
      const { serverId, directory } = sessionScopeOf(sessionID, sessionDirectories, resolvedSessionServers)
      return sessionQueryOptions(sessionID, directory, serverId)
    }),
    combine: combineQuerySessions,
  })

  const mergedSessions = useMemo(
    () => mergeExtraSessions(allSessions, fetchedSessions),
    [allSessions, fetchedSessions],
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
        sessionServers: resolvedSessionServers,
      }),
    [now, windowMs, repos, mergedSessions, resolvedParents, resolvedRoots, resolvedSessionServers],
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
        sessionServers: resolvedSessionServers,
        serverNames,
      }),
    [
      now,
      windowMs,
      repos,
      mergedSessions,
      resolvedParents,
      resolvedRoots,
      outcomes,
      worktrees,
      resolvedSessionServers,
      serverNames,
    ],
  )

  return {
    groups,
    isLoading: isReposLoading || isSessionsLoading || isWorktreesLoading,
    isError: isSessionsError || isWorktreesError,
  }
}
