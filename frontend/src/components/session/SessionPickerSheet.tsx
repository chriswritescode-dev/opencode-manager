import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Repo, Session } from '@/api/types'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { LinkedServersNav } from '@/components/navigation/LinkedServersNav'
import { AddRepoDialog } from '@/components/repo/AddRepoDialog'
import { SessionPickerPanel } from '@/components/session/SessionPickerDialog'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { useSessionPickerRouteScope } from '@/hooks/useSessionPickerRouteScope'
import { getRepoPath, getServerSessionPath, getSessionPath } from '@/lib/navigation'

interface SessionPickerSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function SessionPickerSheet({ isOpen, onClose }: SessionPickerSheetProps) {
  const navigate = useNavigate()
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const { currentRepo, activeSessionID, remote } = useSessionPickerRouteScope(isOpen)

  const navigateReplacing = useCallback(
    (path: string) => {
      navigate(path, { replace: true })
    },
    [navigate],
  )

  const handleSelectSession = useCallback(
    (session: Session, repo: Repo) => {
      if (session.id === activeSessionID) {
        onClose()
        return
      }
      navigateReplacing(getSessionPath(repo.id, session.id))
    },
    [activeSessionID, navigateReplacing, onClose],
  )

  const handleSelectRemoteSession = useCallback(
    (session: Session, serverId: string) => {
      if (session.id === activeSessionID) {
        onClose()
        return
      }
      navigateReplacing(getServerSessionPath(serverId, session.id))
    },
    [activeSessionID, navigateReplacing, onClose],
  )

  const handleDeleteActiveSession = useCallback(() => {
    if (!currentRepo) {
      onClose()
      return
    }
    navigateReplacing(getRepoPath(currentRepo.id))
  }, [currentRepo, navigateReplacing, onClose])

  const panel = isOpen ? (
    <SessionPickerPanel
      open={isOpen}
      currentRepo={currentRepo}
      activeSessionID={activeSessionID}
      onSelectSession={handleSelectSession}
      onSelectRemoteSession={handleSelectRemoteSession}
      onDeleteActiveSession={handleDeleteActiveSession}
      onSelectRepo={(repo) => navigateReplacing(getRepoPath(repo.id))}
      onNavigate={navigateReplacing}
      remote={remote}
      remoteProjects
      searchTrailing={<LinkedServersNav variant="header" />}
      onAddRepo={() => {
        onClose()
        setAddRepoOpen(true)
      }}
    />
  ) : null

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} heightClass="h-[90dvh]" ariaLabel="Sessions">
        {remote ? (
          <OpenCodeServerProvider serverId={remote.serverId}>{panel}</OpenCodeServerProvider>
        ) : (
          panel
        )}
      </BottomSheet>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </>
  )
}
