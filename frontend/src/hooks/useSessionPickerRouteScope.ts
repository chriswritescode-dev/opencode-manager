import { useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo } from '@/api/types'
import { parseRepoRoute, parseServerProjectRoute, parseServerSessionRoute } from '@/lib/navigation'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useOpenCodeServers } from '@/hooks/useOpenCodeServers'
import { useSidebarServerSelection } from '@/hooks/useSidebarServerSelection'

export interface SessionPickerRouteScope {
  currentRepo: Repo | undefined
  activeSessionID: string | undefined
  isRemote: boolean
  remote: { serverId: string; serverName?: string; projectDirectory?: string } | undefined
}

/**
 * Resolves what a session picker opened on the current route should list: the Manager repo of a
 * repo route, or the selected linked server and its project directory.
 */
export function useSessionPickerRouteScope(enabled: boolean): SessionPickerRouteScope {
  const { pathname, search } = useLocation()
  const [selectedServerId] = useSidebarServerSelection()
  const { repos } = useNavigableRepos(enabled)
  const { servers } = useOpenCodeServers({ enabled })

  const isRemote = selectedServerId !== LOCAL_OPENCODE_SERVER_ID
  const repoRoute = parseRepoRoute(pathname)
  const currentRepo = isRemote || repoRoute.repoId === null
    ? undefined
    : repos.find((candidate) => candidate.id === repoRoute.repoId)
  const activeSessionID = repoRoute.sessionId
    ?? parseServerSessionRoute(pathname)?.sessionId
    ?? undefined
  const remoteProjectDirectory = isRemote
    ? parseServerProjectRoute(pathname, search)?.directory
    : undefined

  if (!isRemote) {
    return { currentRepo, activeSessionID, isRemote, remote: undefined }
  }

  return {
    currentRepo,
    activeSessionID,
    isRemote,
    remote: {
      serverId: selectedServerId,
      serverName: servers.find((server) => server.id === selectedServerId)?.name,
      projectDirectory: remoteProjectDirectory,
    },
  }
}
