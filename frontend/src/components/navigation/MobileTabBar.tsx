import { useLocation, useNavigate } from 'react-router-dom'
import { FolderGit2, FolderOpen, Bell, CalendarClock, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobile } from '@/hooks/useMobile'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { usePermissions, useQuestions } from '@/contexts/EventContext'
import { FileBrowserSheet } from '@/components/file-browser/FileBrowserSheet'
import { RepoQuickSwitchSheet } from '@/components/navigation/RepoQuickSwitchSheet'
import { NotificationsSheet } from '@/components/navigation/NotificationsSheet'
import { MoreDrawer } from '@/components/navigation/MoreDrawer'

interface TabDef {
  key: string
  label: string
  icon: React.ElementType
  onClick: () => void
  active: boolean
  badge?: number
}

export function MobileTabBar() {
  const isMobile = useMobile()
  const location = useLocation()
  const navigate = useNavigate()
  const { openSheet, open, close } = useMobileTabBar()
  const { pendingCount: permissionCount } = usePermissions()
  const { pendingCount: questionCount } = useQuestions()
  const totalPending = permissionCount + questionCount

  if (!isMobile) return null

  const allow = location.pathname === '/' || location.pathname === '/schedules'
  if (!allow) return null

  const tabs: TabDef[] = [
    {
      key: 'repos',
      label: 'Repos',
      icon: FolderGit2,
      onClick: () => open('repos'),
      active: openSheet === 'repos' || location.pathname === '/',
    },
    {
      key: 'files',
      label: 'Files',
      icon: FolderOpen,
      onClick: () => open('files'),
      active: openSheet === 'files',
    },
    {
      key: 'notifications',
      label: 'Alerts',
      icon: Bell,
      onClick: () => open('notifications'),
      badge: totalPending,
      active: openSheet === 'notifications',
    },
    {
      key: 'schedules',
      label: 'Schedules',
      icon: CalendarClock,
      onClick: () => navigate('/schedules'),
      active: location.pathname === '/schedules' && !openSheet,
    },
    {
      key: 'more',
      label: 'More',
      icon: Menu,
      onClick: () => open('more'),
      active: openSheet === 'more',
    },
  ]

  return (
    <>
      <div className="fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-card/80 backdrop-blur-sm pb-safe">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              type="button"
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-xs font-medium transition-colors',
                tab.active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={tab.onClick}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {tab.badge && tab.badge > 0 && (
                  <span className="absolute top-1 right-[calc(50%-14px)] w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                )}
              </div>
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {openSheet === 'repos' && (
        <RepoQuickSwitchSheet isOpen onClose={close} />
      )}

      {openSheet === 'files' && (
        <FileBrowserSheet
          isOpen
          onClose={close}
          basePath=""
          repoName="Workspace Root"
        />
      )}

      {openSheet === 'notifications' && (
        <NotificationsSheet isOpen onClose={close} />
      )}

      {openSheet === 'more' && (
        <MoreDrawer isOpen onClose={close} />
      )}
    </>
  )
}
