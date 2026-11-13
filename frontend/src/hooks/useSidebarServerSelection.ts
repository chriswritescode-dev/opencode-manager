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

export function useSidebarServerSelection(): [string, (serverId: string) => void] {
  const serverId = useSidebarServerStore((state) => state.serverId)
  const selectServer = useSidebarServerStore((state) => state.selectServer)

  return [serverId, selectServer]
}
