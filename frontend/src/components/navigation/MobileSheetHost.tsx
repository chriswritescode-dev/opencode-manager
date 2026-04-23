import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useMobile } from '@/hooks/useMobile'
import { FileBrowserSheet } from '@/components/file-browser/FileBrowserSheet'
import { RepoQuickSwitchSheet } from '@/components/navigation/RepoQuickSwitchSheet'
import { NotificationsSheet } from '@/components/navigation/NotificationsSheet'
import { MoreDrawer } from '@/components/navigation/MoreDrawer'

export function MobileSheetHost() {
  const isMobile = useMobile()
  const { openSheet, close } = useMobileTabBar()

  if (!isMobile) return null

  return (
    <>
      {openSheet === 'repos' && <RepoQuickSwitchSheet isOpen onClose={close} />}
      {openSheet === 'files' && (
        <FileBrowserSheet
          isOpen
          onClose={close}
          basePath=""
          repoName="Workspace Root"
          allowNavigateAboveBase={true}
        />
      )}
      {openSheet === 'notifications' && <NotificationsSheet isOpen onClose={close} />}
      {openSheet === 'more' && <MoreDrawer isOpen onClose={close} />}
    </>
  )
}
