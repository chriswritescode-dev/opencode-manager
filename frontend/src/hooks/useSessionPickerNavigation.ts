import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo, Session } from '@/api/types'
import { useSideMenu } from '@/hooks/useSideMenu'
import {
  getServerSessionPath,
  getSessionListPath,
  getSessionPath,
  parseActivePickerSession,
  parseRepoRoute,
  withQueryParam,
} from '@/lib/navigation'
import { getProjectHubPath } from '@/lib/projectTarget'

export interface SessionPickerNavigationOptions {
  onClose: () => void
  /** Leaves the side menu for a path in one history operation. */
  navigateFromMenu: (path: string) => void
}

export interface SessionPickerNavigation {
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
  onSelectRepo: (repo: Repo) => void
  onNavigate: (path: string) => void
}

/**
 * Builds the session picker handlers used by the side menu. The route in view comes from the
 * location: choosing the session already open on the same server only closes the menu. An assistant
 * session keeps `?assistant=1` when the chosen session belongs to the current repo.
 *
 * @param options The picker's close callback and the action that leaves the menu for a path.
 * @returns Handlers for selecting sessions and repos and for following a prepared path.
 */
export function useSessionPickerNavigation({
  onClose,
  navigateFromMenu,
}: SessionPickerNavigationOptions): SessionPickerNavigation {
  const { openMenu, project } = useSideMenu()
  const { pathname, search } = useLocation()
  const currentRepoId = parseRepoRoute(pathname).repoId
  const { sessionId: activeSessionID, serverId: activeServerId } = parseActivePickerSession(pathname)
  const searchParams = new URLSearchParams(search)
  const isAssistantSession = searchParams.get('assistant') === '1'
  const repoTab = searchParams.get('repoTab') ?? undefined

  const onSelectSession = useCallback(
    (session: Session, repo: Repo) => {
      if (session.id === activeSessionID && activeServerId === LOCAL_OPENCODE_SERVER_ID) {
        onClose()
        return
      }
      const sessionPath = getSessionPath(repo.id, session.id)
      navigateFromMenu(
        isAssistantSession && repo.id === currentRepoId
          ? withQueryParam(sessionPath, 'assistant', '1')
          : sessionPath,
      )
    },
    [activeServerId, activeSessionID, currentRepoId, isAssistantSession, navigateFromMenu, onClose],
  )

  const onSelectRemoteSession = useCallback(
    (session: Session, serverId: string) => {
      if (session.id === activeSessionID && serverId === activeServerId) {
        onClose()
        return
      }
      navigateFromMenu(getServerSessionPath(serverId, session.id))
    },
    [activeServerId, activeSessionID, navigateFromMenu, onClose],
  )

  const onDeleteActiveSession = useCallback(() => {
    if (currentRepoId !== null) {
      navigateFromMenu(getSessionListPath(currentRepoId, isAssistantSession, repoTab))
      return
    }
    if (project?.kind === 'server' && project.serverId === activeServerId) {
      navigateFromMenu(getProjectHubPath(project))
      return
    }
    navigateFromMenu('/')
  }, [activeServerId, currentRepoId, isAssistantSession, navigateFromMenu, project, repoTab])

  const onSelectRepo = useCallback(
    (repo: Repo) => {
      openMenu({ page: 'sessions', project: { kind: 'repo', repoId: repo.id } }, 'replace')
    },
    [openMenu],
  )

  return {
    onSelectSession,
    onSelectRemoteSession,
    onDeleteActiveSession,
    onSelectRepo,
    onNavigate: navigateFromMenu,
  }
}
