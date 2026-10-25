import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listProjects, rankProjectsBySessionActivity, sortProjectsByUpdatedAt, type OpenCodeProject } from '@/api/opencode'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { serverScopedKey } from '@/lib/serverScope'
import { cachedListStates } from '@/lib/queryState'

const REMOTE_PROJECT_ACTIVITY_SESSION_LIMIT = 100

export interface UseRemoteProjectsOptions {
  /** Caller-side gate that applies on top of the server's own enabled flag. */
  enabled?: boolean
}

export interface UseRemoteProjectsResult {
  projects: OpenCodeProject[]
  /** True only while no project list is cached and no error settled, so a restore does not flash a skeleton. */
  showsInitialLoading: boolean
  /** True only when the query failed and no cached list remains to render. */
  showsError: boolean
  error: Error | null
  refetch: () => void
}

export interface UseRemoteProjectsByActivityResult extends UseRemoteProjectsResult {
  /** Activity time per project id, for surfaces that label rows with it. */
  activityById: ReadonlyMap<string, number>
}

/**
 * Builds the query options for one linked server's project list so every reader shares the same
 * cache entry and retry policy.
 *
 * @param serverId Linked server whose projects are listed.
 * @returns The query options, without the caller's own enabled gate.
 */
export function remoteProjectsQueryOptions(serverId: string) {
  return {
    queryKey: serverScopedKey(['opencode', 'projects'], serverId),
    queryFn: () => listProjects(serverId),
    retry: false,
  }
}

/**
 * Loads the projects of one linked server, most recently updated first, while that server is enabled.
 *
 * This is the canonical lookup every caller uses to resolve a directory to its project, so it never
 * fetches sessions.
 *
 * @param serverId Linked server whose projects are listed.
 * @param options Caller-side gate for when the projects may be fetched.
 * @returns The update-sorted projects plus the query state callers render.
 */
export function useRemoteProjects(
  serverId: string,
  options: UseRemoteProjectsOptions = {},
): UseRemoteProjectsResult {
  const enabled = options.enabled ?? true
  const { servers } = useOpenCodeServers({ enabled })
  const isServerEnabled = servers.find((server) => server.id === serverId)?.enabled === true
  const projectsQuery = useQuery({
    ...remoteProjectsQueryOptions(serverId),
    enabled: enabled && isServerEnabled,
  })

  const projects = useMemo(
    () => sortProjectsByUpdatedAt(projectsQuery.data ?? []),
    [projectsQuery.data],
  )
  const { showsInitialLoading, showsError } = cachedListStates(
    projectsQuery.data,
    projectsQuery.isError,
    projectsQuery.isEnabled,
  )

  return {
    projects,
    showsInitialLoading,
    showsError,
    error: projectsQuery.error,
    refetch: projectsQuery.refetch,
  }
}

/**
 * Loads the projects of one linked server with the activity time shown and sorted by list surfaces.
 *
 * A single first page of the server's sessions, newest first and across every directory, is enough to
 * date each project; the page is requested only once the projects are known, so canonical lookups
 * through {@link useRemoteProjects} never pay for it.
 *
 * @param serverId Linked server whose projects are listed.
 * @param options Caller-side gate for when the projects and their sessions may be fetched.
 * @returns The activity-sorted projects, their activity times by project id, and the query state.
 */
export function useRemoteProjectsByActivity(
  serverId: string,
  options: UseRemoteProjectsOptions = {},
): UseRemoteProjectsByActivityResult {
  const projectsResult = useRemoteProjects(serverId, options)
  const { data: sessions } = useSessionsAcrossDirectories([], {
    serverId,
    allDirectories: projectsResult.projects.length > 0,
    limit: REMOTE_PROJECT_ACTIVITY_SESSION_LIMIT,
  })

  const activity = useMemo(
    () => rankProjectsBySessionActivity(projectsResult.projects, sessions),
    [projectsResult.projects, sessions],
  )

  const projects = useMemo(() => activity.map((entry) => entry.project), [activity])

  const activityById = useMemo(
    () => new Map(activity.map((entry) => [entry.project.id, entry.activityAt])),
    [activity],
  )

  return {
    ...projectsResult,
    projects,
    activityById,
  }
}
