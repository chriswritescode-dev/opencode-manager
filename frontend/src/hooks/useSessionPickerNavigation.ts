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
   * `replace` rewrites the entry the mobile sheet was opened from so Back returns to the page behind
   * it; `push` adds an entry and closes the picker.
   */
  mode: 'push' | 'replace'
  onClose: () => void
  /** Replaces the default delete behaviour of returning to the current repo's session list. */
  onDeleteActiveSession?: () => void
}

export interface SessionPickerNavigation {
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
  onSelectRepo: (repo: Repo) => void
  onNavigate: (path: string) => void
}

/**
 * Builds the session picker handlers shared by the mobile sheet, the desktop dialog and the session
 * page picker. The route in view comes from the location: choosing the session already open on the
 * same server only closes the picker, and an assistant session keeps `?assistant=1` when the chosen
 * session belongs to the current repo.
 *
 * @param options Navigation mode, the picker's close callback, and an optional delete override.
 * @returns Handlers for selecting sessions and repos and for following a prepared path.
 */
export function useSessionPickerNavigation({
  mode,
  onClose,
  onDeleteActiveSession: deleteActiveSessionOverride,
}: SessionPickerNavigationOptions): SessionPickerNavigation {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const currentRepoId = parseRepoRoute(pathname).repoId
  const { sessionId: activeSessionID, serverId: activeServerId } = parseActivePickerSession(pathname)
  const searchParams = new URLSearchParams(search)
  const isAssistantSession = searchParams.get('assistant') === '1'
  const repoTab = searchParams.get('repoTab') ?? undefined

  const open = useCallback(
    (path: string) => {
      navigate(path, { replace: mode === 'replace' })
      if (mode === 'push') onClose()
    },
    [mode, navigate, onClose],
  )

  const onSelectSession = useCallback(
    (session: Session, repo: Repo) => {
      if (session.id === activeSessionID && activeServerId === LOCAL_OPENCODE_SERVER_ID) {
        onClose()
        return
      }
      const sessionPath = getSessionPath(repo.id, session.id)
      open(
        isAssistantSession && repo.id === currentRepoId
          ? withQueryParam(sessionPath, 'assistant', '1')
          : sessionPath,
      )
    },
    [activeServerId, activeSessionID, currentRepoId, isAssistantSession, onClose, open],
  )

  const onSelectRemoteSession = useCallback(
    (session: Session, serverId: string) => {
      if (session.id === activeSessionID && serverId === activeServerId) {
        onClose()
        return
      }
      open(getServerSessionPath(serverId, session.id))
    },
    [activeServerId, activeSessionID, onClose, open],
  )

  const onDeleteActiveSession = useCallback(() => {
    if (deleteActiveSessionOverride) {
      onClose()
      deleteActiveSessionOverride()
      return
    }
    if (currentRepoId === null) {
      onClose()
      return
    }
    open(getSessionListPath(currentRepoId, isAssistantSession, repoTab))
  }, [currentRepoId, deleteActiveSessionOverride, isAssistantSession, onClose, open, repoTab])

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
