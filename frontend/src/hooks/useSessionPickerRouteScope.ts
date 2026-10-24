import { useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo } from '@/api/types'
import type { RemotePickerScope } from '@/components/session/SessionPickerDialog'
import { parseRepoRoute, parseServerSessionRoute } from '@/lib/navigation'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSidebarServerSelection } from '@/hooks/useSidebarServerSelection'
import { useActiveRemoteDirectory } from '@/hooks/useActiveRemoteDirectory'

export interface SessionPickerRouteScope {
  currentRepo: Repo | undefined
  activeSessionID: string | undefined
  activeServerId: string | undefined
  remote: RemotePickerScope | undefined
}

export function useSessionPickerRouteScope(enabled: boolean): SessionPickerRouteScope {
  const { pathname } = useLocation()
  const [selectedServerId] = useSidebarServerSelection()
  const { repos } = useNavigableRepos(enabled)
  const { servers } = useOpenCodeServers({ enabled })
  const activeRemoteDirectory = useActiveRemoteDirectory(selectedServerId, { enabled })

  const isRemote = selectedServerId !== LOCAL_OPENCODE_SERVER_ID
  const repoRoute = parseRepoRoute(pathname)
  const serverSessionRoute = parseServerSessionRoute(pathname)
  const currentRepo = isRemote || repoRoute.repoId === null
    ? undefined
    : repos.find((candidate) => candidate.id === repoRoute.repoId)
  const activeSessionID = repoRoute.sessionId ?? serverSessionRoute?.sessionId ?? undefined
  const activeServerId = repoRoute.sessionId ? LOCAL_OPENCODE_SERVER_ID : serverSessionRoute?.serverId

  if (!isRemote) {
    return { currentRepo, activeSessionID, activeServerId, remote: undefined }
  }

  return {
    currentRepo,
    activeSessionID,
    activeServerId,
    remote: {
      serverId: selectedServerId,
      serverName: servers.find((server) => server.id === selectedServerId)?.name,
      projectDirectory: activeRemoteDirectory ?? undefined,
    },
  }
}
