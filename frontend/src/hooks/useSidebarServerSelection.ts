import { useEffect } from 'react'
import { useLocation, useMatch } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { isAssistantPath, parseRepoRoute } from '@/lib/navigation'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

function isLocalRoute(pathname: string): boolean {
  return parseRepoRoute(pathname).repoId !== null || isAssistantPath(pathname)
}

/**
 * The linked server selected in the sidebar, defaulting to the local server. The route selects a
 * server when the location changes, selecting a row never navigates, and a selected server that is
 * missing or disabled in a successfully loaded list falls back to local.
 */
export function useSidebarServerSelection(): [string, (serverId: string) => void] {
  const { pathname } = useLocation()
  const routeServerId = useMatch('/servers/:serverId/*')?.params.serverId
  const { servers, isSuccess } = useOpenCodeServers()
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

  return [serverId, selectServer]
}
