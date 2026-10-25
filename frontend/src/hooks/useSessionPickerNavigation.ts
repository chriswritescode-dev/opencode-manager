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
  /**
   * `replace` rewrites the entry the picker was opened from so Back returns to the page behind it;
   * `push` adds an entry and closes the picker; `panel` adds an entry, carries the current `panel`
   * search param onto the destination path and leaves the picker open.
   */
  mode: 'push' | 'replace' | 'panel'
  onClose: () => void
  /** Where to go after the open session is deleted, instead of the current repo's session list. */
  deleteActiveSessionPath?: string
}

export interface SessionPickerNavigation {
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
  onSelectRepo: (repo: Repo) => void
  onNavigate: (path: string) => void
}

/**
 * Builds the session picker handlers shared by the mobile sheet, the desktop dialog, the desktop
 * tool panel and the session page picker. The route in view comes from the location: choosing the
 * session already open on the same server only closes the picker, and does nothing in `panel` mode
 * where the picker stays open. An assistant session keeps `?assistant=1` when the chosen session
 * belongs to the current repo.
 *
 * @param options Navigation mode, the picker's close callback, and an optional delete destination.
 * @returns Handlers for selecting sessions and repos and for following a prepared path.
 */
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
