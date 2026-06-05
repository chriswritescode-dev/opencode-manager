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

function getAssistantNavItem(_pathname: string, variant: NavPrimaryCta['variant'] = 'secondary'): NavPrimaryCta {
  return {
    key: 'assistant',
    label: 'Assistant',
    icon: Bot,
    to: getAssistantPath(),
    variant,
  }
}

function getBaseItems(): MoreDrawerItem[] {
  return [
    { key: 'settings', label: 'Settings', icon: Settings },
    { key: 'logout', label: 'Logout', icon: LogOut },
  ]
}

export function buildNavModel(pathname: string): NavModel {
  const baseItems = getBaseItems()

  const repoDetailMatch = /^\/repos\/(\d+)$/.exec(pathname)
  if (repoDetailMatch) {
    const id = repoDetailMatch[1]
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: `/repos/${id}/schedules` },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items,
    }
  }

  const sessionDetailMatch = /^\/repos\/(\d+)\/sessions\/[^/]+$/.exec(pathname)
  if (sessionDetailMatch) {
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'lsp', label: 'LSP', icon: Code2, dialog: 'lsp' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: `/repos/${sessionDetailMatch[1]}/schedules` },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items,
    }
  }

  if (isAssistantPath(pathname)) {
    const items: MoreDrawerItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: '/repos/0/schedules' },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      ...baseItems,
    ]

    return {
      primary: [
        { key: 'new-session', label: 'New Session', icon: SquarePlus, onSelect: 'new-session', variant: 'primary' },
        getAssistantNavItem(pathname, 'secondary'),
      ],
      items,
    }
  }

  if (pathname === '/schedules' || /^\/repos\/\d+\/schedules$/.test(pathname)) {
    return {
      primary: [
        { key: 'new-schedule', label: 'New Schedule', icon: Clock, onSelect: 'new-schedule', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items: baseItems,
    }
  }

  if (pathname === '/') {
    return {
      primary: [
        { key: 'new-repo', label: 'New Repo', icon: Plus, onSelect: 'new-repo', variant: 'primary' },
        getAssistantNavItem(pathname),
      ],
      items: [
        { key: 'all-schedules', label: 'All Schedules', icon: CalendarClock, to: '/schedules' },
        { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
        ...baseItems,
      ],
    }
  }

  return {
    primary: [
      getAssistantNavItem(pathname),
    ],
    items: baseItems,
  }
}

export function buildMoreItems(pathname: string): MoreDrawerItem[] {
  return buildNavModel(pathname).items
}
