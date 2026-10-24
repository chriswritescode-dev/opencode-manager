import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { findRemoteProjectForDirectory } from '@/api/opencode'
import { sessionQueryOptions } from '@/hooks/useOpenCode'
import { useRemoteProjects } from '@/hooks/useRemoteProjects'
import { parseActivePickerSession, parseServerProjectRoute } from '@/lib/navigation'

export interface ActiveRemoteDirectory {
  directory: string | null
  isPending: boolean
}

/**
 * Reads the session cached on any directory variant of the shared session key for one server, so a
 * page that already loaded the session does not make the picker wait for it again.
 */
function findCachedSession(
  queryClient: QueryClient,
  sessionID: string,
  serverId: string,
): SessionInfo | undefined {
  const scopedServerId = serverId === LOCAL_OPENCODE_SERVER_ID ? undefined : serverId
  const entries = queryClient.getQueriesData<SessionInfo>({
    queryKey: ['opencode', 'session', sessionID],
  })
  return entries.find(([key]) => key[4] === scopedServerId)?.[1]
}

/**
 * Resolves the linked server directory currently in view: the project route's directory when one
 * matches the server, otherwise the canonical project directory that owns the session route's
 * directory, falling back to that directory when no project owns it.
 *
 * @param serverId Linked server whose active directory is resolved.
 * @param options.enabled Whether the lookups may run; omit for routes that always resolve them.
 * @returns The active directory and whether a session route's directory is still resolving; the
 * local server resolves neither.
 */
export function useActiveRemoteDirectory(
  serverId: string,
  { enabled = true }: { enabled?: boolean } = {},
): ActiveRemoteDirectory {
  const { pathname, search } = useLocation()
  const queryClient = useQueryClient()
  const isRemote = serverId !== LOCAL_OPENCODE_SERVER_ID
  const projectRoute = parseServerProjectRoute(pathname, search)
  const activeSession = parseActivePickerSession(pathname)
  const sessionID = isRemote && activeSession.serverId === serverId
    ? activeSession.sessionId
    : undefined
  const cachedSession = useMemo(
    () => (sessionID ? findCachedSession(queryClient, sessionID, serverId) : undefined),
    [queryClient, sessionID, serverId],
  )
  const sessionQuery = useQuery({
    ...sessionQueryOptions(sessionID, undefined, serverId),
    enabled: Boolean(sessionID) && enabled,
    initialData: cachedSession,
  })
  const { projects } = useRemoteProjects(serverId, { enabled: enabled && isRemote })

  if (projectRoute?.serverId === serverId) {
    return { directory: projectRoute.directory, isPending: false }
  }

  const sessionDirectory = sessionQuery.data?.location.directory
  return {
    directory: sessionDirectory
      ? findRemoteProjectForDirectory(projects, sessionDirectory)?.canonical ?? sessionDirectory
      : null,
    isPending: Boolean(sessionID) && enabled && sessionQuery.isPending,
  }
}
