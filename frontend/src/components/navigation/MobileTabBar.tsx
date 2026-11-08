import { memo, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { CalendarClock, Info, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobile } from '@/hooks/useMobile'
import { useScheduleUrlState, type ScheduleTab } from '@/hooks/useScheduleUrlState'
import { projectTargetFromRoute } from '@/lib/projectTarget'
import { getMobileTabRouteState, useTabDestinations, type TabDef } from './tabDestinations'

function buildScheduleTabs(scheduleTab: ScheduleTab, setScheduleTab: (tab: ScheduleTab) => void): TabDef[] {
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

interface TabStripProps {
  tabs: TabDef[]
  className?: string
}

/** Presentational tab row shared by the phone tab bar and the side menu tab strip. */
export const TabStrip = memo(function TabStrip({ tabs, className }: TabStripProps) {
  return (
    <div className={cn('flex border-t border-border bg-card/90 backdrop-blur-sm', className)}>
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
                <span
                  aria-hidden="true"
                  data-unread-badge
                  className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-highlight ring-2 ring-card animate-pulse"
                />
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
  const { scheduleTab, setScheduleTab } = useScheduleUrlState()
  const isMobile = useMobile()
  const routeMode = useMemo(() => getMobileTabRouteState(pathname, search), [pathname, search])
  const target = useMemo(() => projectTargetFromRoute(pathname, search), [pathname, search])
  const destinations = useTabDestinations(target, { inMenu: false })

  const tabs = useMemo<TabDef[]>(
    () => (routeMode === 'schedule' ? buildScheduleTabs(scheduleTab, setScheduleTab) : destinations),
    [routeMode, scheduleTab, setScheduleTab, destinations],
  )

  if (!isMobile) return null
  if (routeMode === 'hidden') return null

  return <TabStrip tabs={tabs} className="fixed bottom-0 inset-x-0 z-40 pb-safe" />
})
