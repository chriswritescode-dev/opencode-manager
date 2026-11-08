import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { Bell, ChevronRight, GitBranch, List, X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { repoQueryOptions } from '@/lib/repoQuery'
import { cn, getDirectoryName, getRepoDisplayName } from '@/lib/utils'
import type { ProjectTarget } from '@/lib/projectTarget'
import { useAuth } from '@/hooks/useAuth'
import { openDialogParams } from '@/hooks/useDialogParam'
import { useNotificationsAction } from '@/hooks/useNotificationsAction'
import { useOpenNavItem } from '@/hooks/useOpenNavItem'
import { useSideMenu } from '@/hooks/useSideMenu'
import { useUrlParams } from '@/hooks/useUrlParams'
import { NotificationsBadge } from '@/components/notifications/NotificationsBadge'
import { buildNavModel, isManagerOnlyNavItem, type NavItem } from './navItems'
import { TabStrip } from './MobileTabBar'
import { getMobileTabRouteState, useTabDestinations } from './tabDestinations'

export interface SideMenuContentProps {
  variant: 'overlay' | 'docked'
  fullWidth: boolean
  onClose: () => void
}

const ACCOUNT_ITEM_KEYS: ReadonlySet<string> = new Set(['settings', 'logout'])

const TAB_ROW_KEYS: ReadonlySet<string> = new Set(['files', 'source-control', 'schedules'])

const ITEM_GROUPS: ReadonlyArray<{ label: string; keys: ReadonlySet<string> }> = [
  { label: 'Workspace', keys: new Set(['files', 'source-control', 'terminal', 'preview', 'walkthrough']) },
  { label: 'Project', keys: new Set(['mcp', 'skills', 'actions', 'schedules', 'all-schedules', 'reset-permissions']) },
]

function navPathForProject(project: ProjectTarget | null): string {
  if (project === null) return '/'
  if (project.kind === 'server') return `/servers/${encodeURIComponent(project.serverId)}/projects`
  if (project.repoId === ASSISTANT_REPO_ID) return `/repos/${ASSISTANT_REPO_ID}/assistant`
  return `/repos/${project.repoId}`
}

function MenuSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-0.5">
      {label && (
        <h3 className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h3>
      )}
      {children}
    </section>
  )
}

interface MenuRowProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
  trailing?: boolean
}

function MenuRow({ icon: Icon, label, onClick, danger, trailing }: MenuRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        danger ? 'hover:bg-destructive/10' : 'hover:bg-accent',
      )}
    >
      <Icon className={cn('h-5 w-5', danger ? 'text-destructive' : 'text-muted-foreground')} />
      <span className={cn('flex-1 font-medium', danger ? 'text-destructive' : 'text-foreground')}>{label}</span>
      {trailing && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
    </button>
  )
}

/** Side menu body shared by the phone overlay and the docked desktop panel. */
export function SideMenuContent({ variant, fullWidth, onClose }: SideMenuContentProps) {
  const location = useLocation()
  const { project, page, setPage } = useSideMenu()
  const menuTabs = useTabDestinations(project, { inMenu: true })
  const { updateParams } = useUrlParams()
  const { logout } = useAuth()
  const { count, destructive, label, press } = useNotificationsAction()
  const openNavItem = useOpenNavItem()

  const repoId = project?.kind === 'repo' && project.repoId !== ASSISTANT_REPO_ID ? project.repoId : null
  const { data: repo } = useQuery({
    ...repoQueryOptions(repoId ?? ASSISTANT_REPO_ID),
    enabled: repoId !== null,
  })

  const projectName = project === null
    ? null
    : project.kind === 'server'
      ? getDirectoryName(project.directory)
      : project.repoId === ASSISTANT_REPO_ID
        ? 'Assistant'
        : repo ? getRepoDisplayName(repo) : null
  const projectBranch = repoId !== null ? repo?.currentBranch || repo?.branch : undefined

  const handleSettingsClick = () => {
    updateParams((params) => {
      params.set('settings', 'open')
      params.delete('settingsTab')
      params.delete('mobileTab')
      params.delete('menu')
      params.delete('menuProject')
    }, 'replace')
  }

  const handleLogoutClick = async () => {
    try {
      await logout()
    } finally {
      onClose()
    }
  }

  const handleItemClick = (item: NavItem) => {
    if (item.key === 'settings') {
      handleSettingsClick()
      return
    }
    if (item.key === 'logout') {
      void handleLogoutClick()
      return
    }
    if (item.dialog) {
      const dialog = item.dialog
      updateParams((params) => {
        openDialogParams(params, dialog)
        params.delete('menu')
        params.delete('menuProject')
      }, 'push')
      return
    }
    openNavItem(item)
  }

  const items = buildNavModel(navPathForProject(project)).items
  const visibleItems = (project?.kind === 'server' ? items.filter((item) => !isManagerOnlyNavItem(item)) : items)
    .filter((item) => !TAB_ROW_KEYS.has(item.key))
    .filter((item) => item.key !== 'logout' || location.pathname === '/')
  const groupedKeys = new Set([...ACCOUNT_ITEM_KEYS, ...ITEM_GROUPS.flatMap(({ keys }) => [...keys])])
  const navigationItems = visibleItems.filter((item) => !groupedKeys.has(item.key))
  const accountItems = visibleItems.filter((item) => ACCOUNT_ITEM_KEYS.has(item.key))
  const itemsInGroup = (keys: ReadonlySet<string>) => visibleItems.filter((item) => keys.has(item.key))
  const showTabStrip = variant === 'docked' || getMobileTabRouteState(location.pathname, location.search) === 'hidden'

  return (
    <div data-variant={variant} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {projectName && (
            <span className="truncate font-medium text-highlight">{projectName}</span>
          )}
          {projectBranch && (
            <>
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{projectBranch}</span>
            </>
          )}
        </div>
        {fullWidth && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            data-testid="side-menu-close"
            className="shrink-0 rounded-sm p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      {count > 0 && (
        <div className="shrink-0 px-2 pt-2">
          <button
            type="button"
            onClick={press}
            aria-label={label}
            className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
          >
            <span className="relative inline-flex shrink-0">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <NotificationsBadge count={count} destructive={destructive} />
            </span>
            <span className="flex-1 font-medium text-foreground">Notifications</span>
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {page === 'sessions' ? (
          <div data-testid="side-menu-sessions-page" className="min-h-0 flex-1" />
        ) : (
          <div className="flex flex-col gap-4">
            <MenuSection>
              <MenuRow icon={List} label="Sessions" onClick={() => setPage('sessions')} trailing />
              {navigationItems.map((item) => (
                <MenuRow
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  danger={item.danger}
                  onClick={() => handleItemClick(item)}
                />
              ))}
            </MenuSection>
            {ITEM_GROUPS.map(({ label: groupLabel, keys }) => {
              const groupItems = itemsInGroup(keys)
              if (groupItems.length === 0) return null
              return (
                <MenuSection key={groupLabel} label={groupLabel}>
                  {groupItems.map((item) => (
                    <MenuRow
                      key={item.key}
                      icon={item.icon}
                      label={item.label}
                      danger={item.danger}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </MenuSection>
              )
            })}
            {accountItems.length > 0 && (
              <MenuSection>
                {accountItems.map((item) => (
                  <MenuRow
                    key={item.key}
                    icon={item.icon}
                    label={item.label}
                    danger={item.danger}
                    onClick={() => handleItemClick(item)}
                  />
                ))}
              </MenuSection>
            )}
          </div>
        )}
      </div>
      {showTabStrip && (
        <TabStrip tabs={menuTabs} className="shrink-0 pb-[calc(env(safe-area-inset-bottom)+0.25rem)]" />
      )}
    </div>
  )
}
