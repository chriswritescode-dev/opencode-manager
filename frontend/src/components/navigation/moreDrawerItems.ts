import type { LucideIcon } from 'lucide-react'
import { Plug, Sparkles, ShieldOff, CalendarClock, GitCommitHorizontal, Code2, Settings, LogOut, Plus, Bot, Folder, Clock, SquarePlus } from 'lucide-react'
import { getAssistantPath, isAssistantPath } from '@/lib/navigation'

export interface MoreDrawerItem {
  key: string
  label: string
  icon: LucideIcon
  to?: string
  dialog?: string
  danger?: boolean
}

export interface NavPrimaryCta {
  key: string
  label: string
  icon: LucideIcon
  to?: string
  onSelect?: 'new-session' | 'new-repo' | 'new-schedule'
  variant?: 'primary' | 'secondary'
}

export interface NavModel {
  primary: NavPrimaryCta[]
  items: MoreDrawerItem[]
}

type TFunction = (key: string) => string

function getAssistantNavItem(_pathname: string, t: TFunction, variant: NavPrimaryCta['variant'] = 'secondary'): NavPrimaryCta {
  return {
    key: 'assistant',
    label: t('assistant.assistant'),
    icon: Bot,
    to: getAssistantPath(),
    variant,
  }
}

function getBaseItems(t: TFunction): MoreDrawerItem[] {
  return [
    { key: 'settings', label: t('nav.settings'), icon: Settings },
    { key: 'logout', label: t('nav.logout'), icon: LogOut },
  ]
}

export function buildNavModel(pathname: string, t: TFunction): NavModel {
  const baseItems = getBaseItems(t)

  const repoDetailMatch = /^\/repos\/(\d+)$/.exec(pathname)
  if (repoDetailMatch) {
    const id = repoDetailMatch[1]
    const items: MoreDrawerItem[] = [
      { key: 'files', label: t('fileBrowser.open'), icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: t('settings.skills'), icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: t('repo.resetPermissions'), icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: t('nav.schedules'), icon: CalendarClock, to: `/repos/${id}/schedules` },
      { key: 'source-control', label: t('repo.sourceControl'), icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: t('nav.newSession'), icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname, t),
      ],
      items,
    }
  }

  const sessionDetailMatch = /^\/repos\/(\d+)\/sessions\/[^/]+$/.exec(pathname)
  if (sessionDetailMatch) {
    const items: MoreDrawerItem[] = [
      { key: 'files', label: t('fileBrowser.open'), icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: t('settings.skills'), icon: Sparkles, dialog: 'skills' },
      { key: 'lsp', label: t('mcp.lspServers'), icon: Code2, dialog: 'lsp' },
      { key: 'reset-permissions', label: t('repo.resetPermissions'), icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: t('nav.schedules'), icon: CalendarClock, to: `/repos/${sessionDetailMatch[1]}/schedules` },
      { key: 'source-control', label: t('repo.sourceControl'), icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: t('nav.newSession'), icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname, t),
      ],
      items,
    }
  }

  if (isAssistantPath(pathname)) {
    const items: MoreDrawerItem[] = [
      { key: 'files', label: t('fileBrowser.open'), icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: t('settings.skills'), icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: t('repo.resetPermissions'), icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: t('nav.schedules'), icon: CalendarClock, to: '/repos/0/schedules' },
      { key: 'source-control', label: t('repo.sourceControl'), icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: t('nav.newSession'), icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname, t, 'secondary'),
      ],
      items,
    }
  }

  if (pathname === '/schedules' || /^\/repos\/\d+\/schedules$/.test(pathname)) {
    return {
      primary: [
        { key: 'new-schedule', label: t('schedule.create'), icon: Clock, onSelect: 'new-schedule', variant: 'primary' },
        getAssistantNavItem(pathname, t),
      ],
      items: baseItems,
    }
  }

  if (pathname === '/') {
    return {
      primary: [
        { key: 'new-repo', label: t('nav.newRepo'), icon: Plus, onSelect: 'new-repo', variant: 'primary' },
        getAssistantNavItem(pathname, t),
      ],
      items: [
        { key: 'all-schedules', label: t('repo.allSchedules'), icon: CalendarClock, to: '/schedules' },
        { key: 'files', label: t('fileBrowser.open'), icon: Folder, dialog: 'files' },
        ...baseItems,
      ],
    }
  }

  return {
    primary: [
      getAssistantNavItem(pathname, t),
    ],
    items: baseItems,
  }
}

export function buildMoreItems(pathname: string, t: TFunction): MoreDrawerItem[] {
  return buildNavModel(pathname, t).items
}
