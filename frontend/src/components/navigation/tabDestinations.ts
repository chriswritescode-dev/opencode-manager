import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, CalendarClock, FolderOpen, GitCommitHorizontal, List } from 'lucide-react'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { isAssistantPath, parseRepoRoute, parseServerProjectRoute } from '@/lib/navigation'
import type { ProjectTarget } from '@/lib/projectTarget'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useOpenProjectTool } from '@/hooks/useOpenProjectTool'
import { useSideMenu } from '@/hooks/useSideMenu'
import { useUnreadScheduleRuns } from '@/hooks/useSchedules'
import { useSidebarServerSelection } from '@/hooks/useSidebarServerSelection'

/** A single tab rendered by the phone tab bar and the side menu tab strip. */
export interface TabDef {
  key: string
  label: string
  icon: React.ElementType
  onClick: () => void
  active: boolean
  badge?: boolean
}

/** Which tab set a route shows: the global destinations, schedule tabs, or none. */
export type TabBarMode = 'hidden' | 'global' | 'schedule'

/**
 * Decides the tab bar mode for a route.
 *
 * @param pathname Pathname of the route.
 * @param search Query string of the route.
 * @returns The tab bar mode the route shows.
 */
export function getMobileTabRouteState(pathname: string, search: string): TabBarMode {
  if (isAssistantPath(pathname)) return 'global'
  if (pathname === '/' || pathname === '/schedules') return 'global'
  if (parseServerProjectRoute(pathname, search)) return 'global'

  const { repoId, section } = parseRepoRoute(pathname)
  if (repoId === null) return 'hidden'
  if (section === null) return 'global'
  if (section === 'schedules') return 'schedule'
  return 'hidden'
}

/**
 * Builds the project-scoped tab destinations shared by the phone tab bar and the side menu tab strip.
 *
 * @param target Project shown by the destination tabs, or null when no project is in view.
 * @returns The destinations to render, in display order.
 */
export function useTabDestinations(target: ProjectTarget | null): TabDef[] {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { isOpen, page, openMenu } = useSideMenu()
  const { openSheet, open } = useMobileTabBar()
  const openProjectTool = useOpenProjectTool()
  const { data: unreadRuns } = useUnreadScheduleRuns()
  const [selectedServerId] = useSidebarServerSelection()
  const localServerSelected = selectedServerId === LOCAL_OPENCODE_SERVER_ID
  const unreadScheduleCount = unreadRuns?.total ?? 0

  return useMemo<TabDef[]>(() => {
    const showsFiles = target === null ? localServerSelected : target.kind === 'repo'
    const showsGit = target === null ? false : target.kind === 'server' || target.repoId !== ASSISTANT_REPO_ID
    const showsSchedules = target === null || (target.kind === 'repo' && target.repoId === ASSISTANT_REPO_ID)

    const tabs: TabDef[] = [
      {
        key: 'sessions',
        label: 'Sessions',
        icon: List,
        onClick: () => openMenu({ page: 'sessions', project: target ?? undefined }),
        active: (isOpen && page === 'sessions') || (!isOpen && pathname === '/' && openSheet === null),
      },
    ]

    if (showsFiles) {
      tabs.push({
        key: 'files',
        label: 'Files',
        icon: FolderOpen,
        onClick: () => {
          if (target === null) {
            open('files')
            return
          }
          openProjectTool({ key: 'files', label: 'Files', icon: FolderOpen, dialog: 'files' }, target)
        },
        active: openSheet === 'files',
      })
    }

    if (showsGit) {
      tabs.push({
        key: 'source-control',
        label: 'Git',
        icon: GitCommitHorizontal,
        onClick: () => openProjectTool(
          { key: 'source-control', label: 'Git', icon: GitCommitHorizontal, dialog: 'sourceControl' },
          target,
        ),
        active: false,
      })
    }

    tabs.push({
      key: 'assistant',
      label: 'Assistant',
      icon: Bot,
      onClick: () => openMenu({ page: 'sessions', project: { kind: 'repo', repoId: ASSISTANT_REPO_ID } }),
      active: target !== null
        && target.kind === 'repo'
        && target.repoId === ASSISTANT_REPO_ID
        && !(isOpen && page === 'sessions'),
    })

    if (showsSchedules) {
      tabs.push({
        key: 'schedules',
        label: 'Schedules',
        icon: CalendarClock,
        onClick: () => navigate('/schedules'),
        active: pathname === '/schedules' && openSheet === null,
        badge: unreadScheduleCount > 0,
      })
    }

    return tabs
  }, [
    target,
    openMenu,
    open,
    openProjectTool,
    navigate,
    isOpen,
    page,
    pathname,
    openSheet,
    localServerSelected,
    unreadScheduleCount,
  ])
}
