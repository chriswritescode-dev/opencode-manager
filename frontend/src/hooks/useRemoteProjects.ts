import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listProjects, rankProjectsBySessionActivity, sortProjectsByUpdatedAt, type OpenCodeProject } from '@/api/opencode'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { serverScopedKey } from '@/lib/serverScope'
import { cachedListStates } from '@/lib/queryState'

const REMOTE_PROJECT_ACTIVITY_SESSION_LIMIT = 100

export interface UseRemoteProjectsOptions {
  enabled?: boolean
}

export interface UseRemoteProjectsResult {
  projects: OpenCodeProject[]
  showsInitialLoading: boolean
  showsError: boolean
  error: Error | null
  refetch: () => void
}

export interface UseRemoteProjectsByActivityResult extends UseRemoteProjectsResult {
  activityById: ReadonlyMap<string, number>
}

export function remoteProjectsQueryOptions(serverId: string) {
  return {
    queryKey: serverScopedKey(['opencode', 'projects'], serverId),
    queryFn: () => listProjects(serverId),
    retry: false,
  }
}

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
