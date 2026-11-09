import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { Bell, Bot, Home, List, LogOut, Settings } from 'lucide-react'
import { useDesktop } from '@/hooks/useDesktop'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useSidebarWidth } from '@/hooks/useSidebarWidth'
import { useAuth } from '@/hooks/useAuth'
import { useNotificationsAction } from '@/hooks/useNotificationsAction'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSideMenu } from '@/hooks/useSideMenu'
import { NotificationsBadge } from '@/components/notifications/NotificationsBadge'
import { LinkedServersNav } from '@/components/navigation/LinkedServersNav'
import { Sidebar, SidebarItem } from '@/components/ui/sidebar'
import { SideMenuContent } from './SideMenuContent'

export function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { openTab: openSettingsTab } = useSettingsDialog()
  const [collapsed, toggle] = useSidebarCollapsed()
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth()
  const { isAuthenticated, isLoading, logout } = useAuth()
  const isDesktop = useDesktop()
  const { isOpen, openMenu, closeMenu } = useSideMenu()
  const { count, destructive, label, press } = useNotificationsAction()
  const handledOpenRef = useRef(false)

  useEffect(() => {
    if (!isDesktop || !isOpen) {
      handledOpenRef.current = false
      return
    }
    if (handledOpenRef.current) return
    handledOpenRef.current = true
    if (collapsed) toggle()
  }, [collapsed, isDesktop, isOpen, toggle])

  if (isLoading || !isAuthenticated || !isDesktop) {
    return null
  }

  const handleSettingsClick = () => openSettingsTab('account')

  return (
    <Sidebar
      collapsed={collapsed}
      onToggle={toggle}
      width={sidebarWidth}
      onWidthChange={setSidebarWidth}
      className="mt-2"
    >
      {collapsed ? (
        <>
          <div className="flex flex-col gap-1 p-2 pt-0">
            {count > 0 && (
              <SidebarItem
                icon={Bell}
                label={label}
                collapsed
                onClick={press}
                badge={<NotificationsBadge count={count} destructive={destructive} />}
              />
            )}
            <SidebarItem
              icon={List}
              label="Sessions"
              collapsed
              onClick={() => {
                handledOpenRef.current = true
                toggle()
                openMenu({ page: 'sessions' })
              }}
            />
            <SidebarItem
              icon={Bot}
              label="Assistant"
              collapsed
              onClick={() => openMenu({ page: 'sessions', project: { kind: 'repo', repoId: ASSISTANT_REPO_ID } })}
            />
            <SidebarItem icon={Home} label="Home" collapsed onClick={() => navigate('/')} />
            <SidebarItem icon={Settings} label="Settings" collapsed onClick={handleSettingsClick} />
            {location.pathname === '/' && (
              <SidebarItem icon={LogOut} label="Logout" collapsed onClick={() => { void logout() }} />
            )}
          </div>
          <LinkedServersNav variant="rail" />
        </>
      ) : (
        <SideMenuContent variant="docked" fullWidth={false} onClose={closeMenu} defaultPage="sessions" />
      )}
    </Sidebar>
  )
}
