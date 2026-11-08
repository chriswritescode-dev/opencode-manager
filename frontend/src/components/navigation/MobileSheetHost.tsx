import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useMobile } from '@/hooks/useMobile'
import { FileBrowserSheet } from '@/components/file-browser/FileBrowserSheet'
import { SessionPickerSheet } from '@/components/session/SessionPickerSheet'
import { NotificationsSheet } from '@/components/navigation/NotificationsSheet'
import { isLocalOpenCodeServer, useRouteOpenCodeServerId } from '@/contexts/OpenCodeServerContext'

export function MobileSheetHost() {
  const isMobile = useMobile()
  const { openSheet, close } = useMobileTabBar()
  const isRemoteRoute = !isLocalOpenCodeServer(useRouteOpenCodeServerId())

  return (
    <>
      {isMobile && <SessionPickerSheet isOpen={openSheet === 'sessions'} onClose={close} />}
      {isMobile && openSheet === 'files' && !isRemoteRoute && (
        <FileBrowserSheet
          isOpen
          onClose={close}
          basePath=""
          repoName="Workspace Root"
          allowNavigateAboveBase={true}
        />
      )}
      {openSheet === 'notifications' && <NotificationsSheet isOpen onClose={close} />}
    </>
  )
}
