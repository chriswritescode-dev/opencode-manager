import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useRef, useEffect, type ReactNode } from 'react'
import { ChevronRight, FolderGit2, X, GitBranch, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useUrlParams } from '@/hooks/useUrlParams'
import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useRefreshOnOpen } from '@/hooks/useRefreshOnOpen'
import { SideDrawer, SideDrawerContent } from '@/components/ui/side-drawer'
import { buildMoreItems, buildNavModel, isSessionDetailPath, type MoreDrawerItem } from './moreDrawerItems'
import { useSwipeBack } from '@/hooks/useMobile'
import { cn, getRepoDisplayName } from '@/lib/utils'
import { getPathWithReturnTo, isAssistantPath } from '@/lib/navigation'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'

interface MoreDrawerProps {
  isOpen: boolean
  onClose: () => void
}

const ACCOUNT_ITEM_KEYS: ReadonlySet<string> = new Set(['settings', 'logout'])

const ITEM_GROUPS: ReadonlyArray<{ label: string; keys: ReadonlySet<string> }> = [
  { label: 'Workspace', keys: new Set(['files', 'source-control', 'terminal', 'preview', 'walkthrough']) },
  { label: 'Project', keys: new Set(['mcp', 'skills', 'actions', 'schedules', 'all-schedules', 'reset-permissions']) },
]

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

export function MoreDrawer({ isOpen, onClose }: MoreDrawerProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const repoId = id ? Number(id) : null
  const swipeRef = useRef<HTMLDivElement>(null)
  const { bind } = useSwipeBack(onClose, { enabled: isOpen, suspendsRouteSwipe: true })
  const { searchParams, updateParams } = useUrlParams()
  const { logout } = useAuth()
  const { data: health } = useServerHealth()
  const isSessionDetail = isSessionDetailPath(location.pathname)
  const isAssistantRoute = isAssistantPath(location.pathname)
  const isAssistantSession = isSessionDetail && searchParams.get('assistant') === '1'
  const { open: openMobileSheet } = useMobileTabBar()

  useEffect(() => {
    if (isOpen && swipeRef.current) {
      const cleanup = bind(swipeRef.current)
      return cleanup
    }
  }, [isOpen, bind])

  const { data: repo, refetch: refetchRepo } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => repoId ? getRepo(repoId) : null,
    enabled: !!repoId,
  })

  useRefreshOnOpen(isOpen && repoId != null, () => { void refetchRepo() })

  const currentBranch = repo?.currentBranch || repo?.branch
  const repoDisplayName = isAssistantRoute || isAssistantSession
    ? 'Assistant'
    : repo ? getRepoDisplayName(repo) : null

  const handleSettingsClick = () => {
    updateParams((p) => {
      p.delete('mobileTab')
      p.set('settings', 'open')
      p.set('settingsTab', 'account')
    }, 'replace')
  }

  const handleLogoutClick = async () => {
    try {
      await logout()
    } finally {
      onClose()
    }
  }

  const handleItemClick = (item: MoreDrawerItem) => {
    if (item.key === 'settings') {
      handleSettingsClick()
      return
    }
    if (item.key === 'logout') {
      void handleLogoutClick()
      return
    }
    if (item.to) {
      const to = item.key === 'schedules'
        ? getPathWithReturnTo(item.to, `${location.pathname}${location.search}`)
        : item.to
      navigate(to)
    } else if (item.dialog) {
      updateParams((p) => {
        p.set('dialog', item.dialog!)
        p.delete('mobileTab')
      }, 'replace')
    }
  }

  const items = buildMoreItems(location.pathname)
  const itemsInGroup = (keys: ReadonlySet<string>) => items.filter((item) => keys.has(item.key))
  const groupedKeys = new Set([...ACCOUNT_ITEM_KEYS, ...ITEM_GROUPS.flatMap(({ keys }) => [...keys])])
  const navigationItems = items.filter((item) => !groupedKeys.has(item.key))
  const assistantCta = isSessionDetail && !isAssistantSession
    ? buildNavModel(location.pathname).primary.find((cta) => cta.key === 'assistant')
    : undefined

  const opencodeVersion = health?.opencodeVersion
  const managerVersion = health?.opencodeManagerVersion
  const versionLabel = [
    opencodeVersion ? `v${opencodeVersion}` : null,
    managerVersion ? `Manager v${managerVersion}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} side="right" ariaLabel="More" widthClass="w-screen sm:w-[min(90vw,420px)]">
      <div ref={swipeRef} className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-col flex-shrink-0 border-b border-border bg-background px-4 py-1.5">
          <div className="flex items-center justify-between gap-3 mb-2">
            {versionLabel && (
              <span className="truncate text-xs leading-tight text-muted-foreground">{versionLabel}</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-sm p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {(repoDisplayName || currentBranch) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {repoDisplayName && (
                <span className="font-medium text-highlight">{repoDisplayName}</span>
              )}

              {currentBranch && (
                <>
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>{currentBranch}</span>
                </>
              )}
            </div>
          )}
        </div>
        <SideDrawerContent className="flex flex-col gap-4 pb-3">
          <MenuSection>
            {isSessionDetail && (
              <MenuRow icon={FolderGit2} label="Repos" onClick={() => openMobileSheet('repos')} trailing />
            )}
            {assistantCta?.to && (
              <MenuRow icon={assistantCta.icon} label={assistantCta.label} onClick={() => navigate(assistantCta.to!)} />
            )}
            {navigationItems.map((item) => (
              <MenuRow key={item.key} icon={item.icon} label={item.label} danger={item.danger} onClick={() => handleItemClick(item)} />
            ))}
          </MenuSection>
          {ITEM_GROUPS.map(({ label, keys }) => {
            const groupItems = itemsInGroup(keys)
            if (groupItems.length === 0) return null
            return (
              <MenuSection key={label} label={label}>
                {groupItems.map((item) => (
                  <MenuRow key={item.key} icon={item.icon} label={item.label} danger={item.danger} onClick={() => handleItemClick(item)} />
                ))}
              </MenuSection>
            )
          })}
        </SideDrawerContent>
        <div className="flex flex-shrink-0 gap-2 border-t border-border bg-background px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          {itemsInGroup(ACCOUNT_ITEM_KEYS).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => handleItemClick(item)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border p-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <item.icon className="h-4 w-4 text-muted-foreground" />
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </SideDrawer>
  )
}
