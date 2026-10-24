import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { sessionQueryOptions } from '@/hooks/useOpenCode'
import { parseServerProjectRoute, parseServerSessionRoute } from '@/lib/navigation'

/**
 * Resolves the linked server directory currently in view: the project route's directory when one
 * matches the server, otherwise the directory of the session route it belongs to.
 *
 * @param serverId Linked server whose active directory is resolved.
 * @param options.enabled Whether the session lookup may run; omit for routes that always resolve it.
 * @returns The active directory, or null when neither route identifies one.
 */
export function useActiveRemoteDirectory(
  serverId: string,
  { enabled = true }: { enabled?: boolean } = {},
): string | null {
  const { pathname, search } = useLocation()
  const projectRoute = parseServerProjectRoute(pathname, search)
  const sessionRoute = parseServerSessionRoute(pathname)
  const sessionID = sessionRoute?.serverId === serverId ? sessionRoute.sessionId : undefined
  const { data: session } = useQuery({
    ...sessionQueryOptions(sessionID, undefined, serverId),
    enabled: Boolean(sessionID) && enabled,
  })

  if (projectRoute?.serverId === serverId) return projectRoute.directory
  return session?.location.directory ?? null
}
