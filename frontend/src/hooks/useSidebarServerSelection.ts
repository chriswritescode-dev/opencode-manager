import { useEffect } from 'react'
import { useLocation, useMatch } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useAuth } from '@/hooks/useAuth'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { isAssistantPath, parseRepoRoute } from '@/lib/navigation'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

function isLocalRoute(pathname: string): boolean {
  return parseRepoRoute(pathname).repoId !== null || isAssistantPath(pathname)
}

/**
 * Keeps the sidebar server selection in step with the location and the linked server list: a linked
 * server route selects that server, a local repo or assistant route selects local, and a selected
 * server that is missing or disabled in a successfully loaded list falls back to local. Mounted once
 * inside `AuthProvider` by the app shell so the selection follows the route even when no sidebar
 * consumer is rendered; the server list is only loaded once authenticated.
 */
export function useSidebarServerRouteSync(): void {
  const { pathname } = useLocation()
  const routeServerId = useMatch('/servers/:serverId/*')?.params.serverId
  const { isAuthenticated } = useAuth()
  const { servers, isSuccess } = useOpenCodeServers({ enabled: isAuthenticated })
  const serverId = useSidebarServerStore((state) => state.serverId)
  const selectServer = useSidebarServerStore((state) => state.selectServer)

  useEffect(() => {
    const current = useSidebarServerStore.getState().serverId
    if (routeServerId) {
      if (current !== routeServerId) selectServer(routeServerId)
      return
    }
    if (isLocalRoute(pathname) && current !== LOCAL_OPENCODE_SERVER_ID) {
      selectServer(LOCAL_OPENCODE_SERVER_ID)
    }
  }, [pathname, routeServerId, selectServer])

  useEffect(() => {
    if (!isSuccess || serverId === LOCAL_OPENCODE_SERVER_ID) return
    const server = servers.find((candidate) => candidate.id === serverId)
    if (!server || !server.enabled) {
      selectServer(LOCAL_OPENCODE_SERVER_ID)
    }
  }, [isSuccess, servers, serverId, selectServer])
}

/**
 * The linked server selected in the sidebar, defaulting to the local server. Selecting a server
 * never navigates; `useSidebarServerRouteSync` keeps the selection aligned with the route.
 */
export function useSidebarServerSelection(): [string, (serverId: string) => void] {
  const serverId = useSidebarServerStore((state) => state.serverId)
  const selectServer = useSidebarServerStore((state) => state.selectServer)

  return [serverId, selectServer]
}
