import { memo, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FolderGit2, FolderOpen, CalendarClock, Menu, Info, History, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobile } from '@/hooks/useMobile'
import { useMobileTabBar, useScheduleTab, type ScheduleTabKey } from '@/hooks/useMobileTabBar'

interface TabDef {
  key: string
  label: string
  icon: React.ElementType
  onClick: () => void
  active: boolean
  badge?: boolean
}

interface GlobalTabsArgs {
  pathname: string
  search: string
  openSheet: ReturnType<typeof useMobileTabBar>['openSheet']
  open: ReturnType<typeof useMobileTabBar>['open']
  close: ReturnType<typeof useMobileTabBar>['close']
  navigate: ReturnType<typeof useNavigate>
  isInsideRepo: boolean
  repoId: string | null
}

type TabBarMode = 'hidden' | 'global' | 'schedule'

interface MobileTabRouteState {
  mode: TabBarMode
  isInsideRepo: boolean
  repoId: string | null
}

function getMobileTabRouteState(pathname: string): MobileTabRouteState {
  const repoMatch = pathname.match(/^\/repos\/(\d+)(?:\/([^/]+))?/)
  const repoId = repoMatch?.[1] ?? null
  const repoSection = repoMatch?.[2]

  if (pathname === '/' || pathname === '/schedules' || pathname === '/assistant') {
    return { mode: 'global', isInsideRepo: false, repoId: null }
  }

  if (!repoId) {
    return { mode: 'hidden', isInsideRepo: false, repoId: null }
  }

  switch (repoSection) {
    case undefined:
    case 'memories':
    case 'assistant':
      return { mode: 'global', isInsideRepo: true, repoId }
    case 'schedules':
      return { mode: 'schedule', isInsideRepo: true, repoId }
    default:
      return { mode: 'hidden', isInsideRepo: false, repoId }
  }
}

function buildGlobalTabs({ pathname, search, openSheet, open, close, navigate, isInsideRepo, repoId }: GlobalTabsArgs): TabDef[] {
  const navigateWithSearch = (params: URLSearchParams) => {
    const nextSearch = params.toString()
    navigate(nextSearch ? `${pathname}?${nextSearch}` : pathname, { replace: true })
  }

  const handleFilesClick = () => {
    if (isInsideRepo && repoId) {
      const newParams = new URLSearchParams(search)
      newParams.set('dialog', 'files')
      navigateWithSearch(newParams)
    } else {
      open('files')
    }
  }

  const handleAssistantClick = () => {
    if (repoId) {
      close()
      navigate(`/repos/${repoId}/assistant`)
      return
    }

    close()
    navigate('/assistant')
  }

  return [
    {
      key: 'repos',
      label: 'Repos',
      icon: FolderGit2,
      onClick: () => open('repos'),
      active: openSheet === 'repos' || (pathname === '/' && !openSheet),
    },
    {
      key: 'files',
      label: 'Files',
      icon: FolderOpen,
      onClick: handleFilesClick,
      active: openSheet === 'files',
    },
    {
      key: 'assistant',
      label: 'Assistant',
      icon: Bot,
      onClick: handleAssistantClick,
      active: isInsideRepo && pathname === `/repos/${repoId}/assistant` && !openSheet,
    },
    {
      key: 'schedules',
      label: 'Schedules',
      icon: CalendarClock,
      onClick: () => navigate('/schedules'),
      active: pathname === '/schedules' && !openSheet,
    },
    {
      key: 'more',
      label: 'More',
      icon: Menu,
      onClick: () => open('more'),
      active: openSheet === 'more',
    },
  ]
}

function buildScheduleTabs(scheduleTab: ScheduleTabKey, setScheduleTab: (tab: ScheduleTabKey) => void): TabDef[] {
  return [
    {
      key: 'jobs',
      label: 'Jobs',
      icon: CalendarClock,
      onClick: () => setScheduleTab('jobs'),
      active: scheduleTab === 'jobs',
    },
    {
      key: 'detail',
      label: 'Detail',
      icon: Info,
      onClick: () => setScheduleTab('detail'),
      active: scheduleTab === 'detail',
    },
    {
      key: 'runs',
      label: 'Runs',
      icon: History,
      onClick: () => setScheduleTab('runs'),
      active: scheduleTab === 'runs',
    },
  ]
}

interface TabBarRowProps {
  tabs: TabDef[]
}

const TabBarRow = memo(function TabBarRow({ tabs }: TabBarRowProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-card/90 backdrop-blur-sm pb-safe">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            type="button"
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium border-b-2 transition-colors',
              tab.active
                ? 'text-primary border-primary'
                : 'text-muted-foreground border-transparent hover:text-foreground',
            )}
            onClick={tab.onClick}
          >
            <div className="relative">
              <Icon className="w-5 h-5" />
              {tab.badge && (
                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-orange-500 ring-2 ring-card animate-pulse" />
              )}
            </div>
            <span className="leading-none">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
})

export const MobileTabBar = memo(function MobileTabBar() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { openSheet, open, close } = useMobileTabBar()
  const { scheduleTab, setScheduleTab } = useScheduleTab()
  const isMobile = useMobile()
  const routeState = useMemo(() => getMobileTabRouteState(pathname), [pathname])

  const tabs = useMemo<TabDef[]>(
    () => (routeState.mode === 'schedule'
      ? buildScheduleTabs(scheduleTab, setScheduleTab)
      : buildGlobalTabs({
        pathname,
        search,
        openSheet,
        open,
        close,
        navigate,
        isInsideRepo: routeState.isInsideRepo,
        repoId: routeState.repoId,
      })),
    [
      routeState,
      scheduleTab,
      setScheduleTab,
      pathname,
      search,
      openSheet,
      open,
      close,
      navigate,
    ],
  )

  if (!isMobile) return null
  if (routeState.mode === 'hidden') return null

  return <TabBarRow tabs={tabs} />
})
