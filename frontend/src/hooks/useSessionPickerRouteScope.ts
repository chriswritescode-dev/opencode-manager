import { useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo } from '@/api/types'
import type { RemotePickerScope } from '@/components/session/SessionPickerPanel'
import { parseActivePickerSession, parseRepoRoute } from '@/lib/navigation'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSidebarServerSelection } from '@/hooks/useSidebarServerSelection'
import { useActiveRemoteDirectory } from '@/hooks/useActiveRemoteDirectory'
import { useSideMenu } from '@/hooks/useSideMenu'

export interface SessionPickerRouteScope {
  currentRepo: Repo | undefined
  activeSessionID: string | undefined
  remote: RemotePickerScope | undefined
}

export function useSessionPickerRouteScope(enabled: boolean): SessionPickerRouteScope {
  const { pathname } = useLocation()
  const { project } = useSideMenu()
  const [selectedServerId] = useSidebarServerSelection()
  const { repos } = useNavigableRepos(enabled)
  const { servers } = useOpenCodeServers({ enabled })
  const activeRemoteDirectory = useActiveRemoteDirectory(selectedServerId, {
    enabled: enabled && project === null,
  })

  const activeSessionID = parseActivePickerSession(pathname).sessionId

  if (project?.kind === 'repo') {
    return {
      currentRepo: repos.find((candidate) => candidate.id === project.repoId),
      activeSessionID,
      remote: undefined,
    }
  }

  if (project?.kind === 'server') {
    return {
      currentRepo: undefined,
      activeSessionID,
      remote: {
        serverId: project.serverId,
        serverName: servers.find((server) => server.id === project.serverId)?.name,
        projectDirectory: project.directory,
      },
    }
  }

  const isRemote = selectedServerId !== LOCAL_OPENCODE_SERVER_ID
  const repoRoute = parseRepoRoute(pathname)
  const currentRepo = isRemote || repoRoute.repoId === null
    ? undefined
    : repos.find((candidate) => candidate.id === repoRoute.repoId)

  if (!isRemote) {
    return { currentRepo, activeSessionID, remote: undefined }
  }

  return {
    currentRepo,
    activeSessionID,
    remote: {
      serverId: selectedServerId,
      serverName: servers.find((server) => server.id === selectedServerId)?.name,
      projectDirectory: activeRemoteDirectory.directory ?? undefined,
      isPending: activeRemoteDirectory.isPending,
    },
  }
}
