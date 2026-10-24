import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listProjects, sortProjectsByActivity, type OpenCodeProject } from '@/api/opencode'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { serverScopedKey } from '@/lib/serverScope'

export interface UseRemoteProjectsOptions {
  /** Caller-side gate that applies on top of the server's own enabled flag. */
  enabled?: boolean
}

export interface UseRemoteProjectsResult {
  projects: OpenCodeProject[]
  isLoading: boolean
  isError: boolean
  hasData: boolean
  error: Error | null
  refetch: () => void
}

/**
 * Loads the projects of one linked server, most recently active first, while that server is enabled.
 *
 * @param serverId Linked server whose projects are listed.
 * @param options Caller-side gate for when the projects may be fetched.
 * @returns The activity-sorted projects plus the query state callers render.
 */
export function useRemoteProjects(
  serverId: string,
  options: UseRemoteProjectsOptions = {},
): UseRemoteProjectsResult {
  const enabled = options.enabled ?? true
  const { servers } = useOpenCodeServers({ enabled })
  const isServerEnabled = servers.find((server) => server.id === serverId)?.enabled === true
  const projectsQuery = useQuery({
    queryKey: serverScopedKey(['opencode', 'projects'], serverId),
    queryFn: () => listProjects(serverId),
    enabled: enabled && isServerEnabled,
    retry: false,
  })

  const projects = useMemo(
    () => sortProjectsByActivity(projectsQuery.data ?? []),
    [projectsQuery.data],
  )

  return {
    projects,
    isLoading: projectsQuery.isLoading,
    isError: projectsQuery.isError,
    hasData: projectsQuery.data !== undefined,
    error: projectsQuery.error,
    refetch: projectsQuery.refetch,
  }
}
