import type { LucideIcon } from 'lucide-react'
import { BookOpen, Plug, Sparkles, ShieldOff, CalendarClock, GitCommitHorizontal, SquareTerminal, Settings, LogOut, Bot, Folder, Home, Play, Globe, KeyRound } from 'lucide-react'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { getAssistantPath, isAssistantPath } from '@/lib/navigation'

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  to?: string
  dialog?: string
  panelTool?: string
  danger?: boolean
}

export interface NavPrimaryCta {
  key: string
  label: string
  icon: LucideIcon
  to: string
  variant?: 'primary' | 'secondary'
}

export interface NavModel {
  primary: NavPrimaryCta[]
  items: NavItem[]
}

function getAssistantNavItem(): NavPrimaryCta {
  return {
    key: 'assistant',
    label: 'Assistant',
    icon: Bot,
    to: getAssistantPath(),
    variant: 'secondary',
  }
}

function getHomeItem(): NavItem {
  return { key: 'home', label: 'Home', icon: Home, to: '/' }
}

function getBaseItems(): NavItem[] {
  return [
    { key: 'settings', label: 'Settings', icon: Settings },
    { key: 'logout', label: 'Logout', icon: LogOut },
  ]
}

const SESSION_DETAIL_PATH = /^\/repos\/(\d+)\/sessions\/[^/]+$/
const SERVER_SESSION_DETAIL_PATH = /^\/servers\/[^/]+\/sessions\/[^/]+$/
const SERVER_PROJECT_PATH = /^\/servers\/[^/]+\/projects$/

const NON_TOOL_ITEM_KEYS = new Set(['home', 'settings', 'logout'])

const MANAGER_ONLY_ITEM_KEYS: ReadonlySet<string> = new Set([
  'files',
  'preview',
  'walkthrough',
  'actions',
  'reset-permissions',
  'schedules',
  'all-schedules',
])

/** True for an item that opens a Manager feature a linked OpenCode server cannot serve. */
export function isManagerOnlyNavItem(item: NavItem): boolean {
  return MANAGER_ONLY_ITEM_KEYS.has(item.key)
}

/** Route-scoped tool items, shown in the desktop tool rail instead of the sidebar. */
export function buildToolItems(pathname: string): NavItem[] {
  return buildNavModel(pathname).items.filter((item) => !NON_TOOL_ITEM_KEYS.has(item.key))
}

/** The `?panel=`/`?dialog=` tool identifier an item targets, preferring its panel tool. */
export function toolKeyOf(item: NavItem): string | null {
  return item.panelTool ?? item.dialog ?? null
}

function buildRouteNavModel(pathname: string): NavModel {
  const baseItems = getBaseItems()

  if (SERVER_SESSION_DETAIL_PATH.test(pathname) || SERVER_PROJECT_PATH.test(pathname)) {
    return {
      primary: [getAssistantNavItem()],
      items: [
        { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
        { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
        { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
        { key: 'terminal', label: 'Terminal', icon: SquareTerminal, dialog: 'terminal' },
        ...baseItems,
      ],
    }
  }

  const repoDetailMatch = /^\/repos\/(\d+)$/.exec(pathname)
  if (repoDetailMatch) {
    const id = repoDetailMatch[1]
    const items: NavItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'secrets', label: 'Secrets', icon: KeyRound, dialog: 'secrets' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: `/repos/${id}/schedules`, panelTool: 'schedules' },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      { key: 'terminal', label: 'Terminal', icon: SquareTerminal, dialog: 'terminal' },
      { key: 'actions', label: 'Actions', icon: Play, dialog: 'actions' },
      { key: 'preview', label: 'Preview', icon: Globe, dialog: 'preview' },
      ...baseItems,
    ]

    return {
      primary: [getAssistantNavItem()],
      items,
    }
  }

  const sessionDetailMatch = SESSION_DETAIL_PATH.exec(pathname)
  if (sessionDetailMatch) {
    const repoId = sessionDetailMatch[1]
    const isAssistantRepo = repoId === String(ASSISTANT_REPO_ID)
    const items: NavItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: `/repos/${repoId}/schedules`, panelTool: 'schedules' },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      { key: 'terminal', label: 'Terminal', icon: SquareTerminal, dialog: 'terminal' },
      { key: 'walkthrough', label: 'Walkthrough', icon: BookOpen, dialog: 'walkthrough' },
      ...(isAssistantRepo
        ? []
        : [{ key: 'actions', label: 'Actions', icon: Play, dialog: 'actions' }]),
      { key: 'preview', label: 'Preview', icon: Globe, dialog: 'preview' },
      ...baseItems,
    ]

    return {
      primary: [getAssistantNavItem()],
      items,
    }
  }

  if (isAssistantPath(pathname)) {
    const items: NavItem[] = [
      { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
      { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
      { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
      { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
      { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: '/repos/0/schedules', panelTool: 'schedules' },
      { key: 'source-control', label: 'Source Control', icon: GitCommitHorizontal, dialog: 'sourceControl' },
      { key: 'terminal', label: 'Terminal', icon: SquareTerminal, dialog: 'terminal' },
      { key: 'preview', label: 'Preview', icon: Globe, dialog: 'preview' },
      ...baseItems,
    ]

    return {
      primary: [getAssistantNavItem()],
      items,
    }
  }

  if (pathname === '/') {
    return {
      primary: [getAssistantNavItem()],
      items: [
        { key: 'all-schedules', label: 'All Schedules', icon: CalendarClock, to: '/schedules' },
        { key: 'files', label: 'Files', icon: Folder, dialog: 'files' },
        ...baseItems,
      ],
    }
  }

  return {
    primary: [getAssistantNavItem()],
    items: baseItems,
  }
}

export function buildNavModel(pathname: string): NavModel {
  const { primary, items } = buildRouteNavModel(pathname)
  return { primary, items: [getHomeItem(), ...items] }
}
