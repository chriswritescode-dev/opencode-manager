import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo, Session } from '@/api/types'
import {
  getRepoPath,
  getServerSessionPath,
  getSessionListPath,
  getSessionPath,
  parseActivePickerSession,
  parseRepoRoute,
  withQueryParam,
} from '@/lib/navigation'

export interface SessionPickerNavigationOptions {
  mode: 'push' | 'replace' | 'panel'
  onClose: () => void
  deleteActiveSessionPath?: string
}

export interface SessionPickerNavigation {
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
  onSelectRepo: (repo: Repo) => void
  onNavigate: (path: string) => void
}

export function useSessionPickerNavigation({
  mode,
  onClose,
  deleteActiveSessionPath,
}: SessionPickerNavigationOptions): SessionPickerNavigation {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const currentRepoId = parseRepoRoute(pathname).repoId
  const { sessionId: activeSessionID, serverId: activeServerId } = parseActivePickerSession(pathname)
  const searchParams = new URLSearchParams(search)
  const isAssistantSession = searchParams.get('assistant') === '1'
  const repoTab = searchParams.get('repoTab') ?? undefined
  const panelId = searchParams.get('panel')
  const isPanelMode = mode === 'panel'

  const open = useCallback(
    (path: string) => {
      navigate(isPanelMode && panelId ? withQueryParam(path, 'panel', panelId) : path, {
        replace: mode === 'replace',
      })
      if (mode === 'push') onClose()
    },
    [isPanelMode, mode, navigate, onClose, panelId],
  )

  const onSelectSession = useCallback(
    (session: Session, repo: Repo) => {
      if (session.id === activeSessionID && activeServerId === LOCAL_OPENCODE_SERVER_ID) {
        if (!isPanelMode) onClose()
        return
      }
      const sessionPath = getSessionPath(repo.id, session.id)
      open(
        isAssistantSession && repo.id === currentRepoId
          ? withQueryParam(sessionPath, 'assistant', '1')
          : sessionPath,
      )
    },
    [activeServerId, activeSessionID, currentRepoId, isAssistantSession, isPanelMode, onClose, open],
  )

  const onSelectRemoteSession = useCallback(
    (session: Session, serverId: string) => {
      if (session.id === activeSessionID && serverId === activeServerId) {
        if (!isPanelMode) onClose()
        return
      }
      open(getServerSessionPath(serverId, session.id))
    },
    [activeServerId, activeSessionID, isPanelMode, onClose, open],
  )

  const onDeleteActiveSession = useCallback(() => {
    if (deleteActiveSessionPath) {
      open(deleteActiveSessionPath)
      return
    }
    if (currentRepoId === null) {
      if (!isPanelMode) onClose()
      return
    }
    open(getSessionListPath(currentRepoId, isAssistantSession, repoTab))
  }, [
    currentRepoId,
    deleteActiveSessionPath,
    isAssistantSession,
    isPanelMode,
    onClose,
    open,
    repoTab,
  ])

  const onSelectRepo = useCallback(
    (repo: Repo) => {
      open(getRepoPath(repo.id))
    },
    [open],
  )

  return {
    onSelectSession,
    onSelectRemoteSession,
    onDeleteActiveSession,
    onSelectRepo,
    onNavigate: open,
  }
}
