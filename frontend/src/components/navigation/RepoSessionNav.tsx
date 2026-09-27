import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell, ChevronDown, ChevronRight, HelpCircle, Pin, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { useForms, usePermissions } from '@/contexts/EventContext'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useSidebarRepoGroups } from '@/hooks/useSidebarRepoGroups'
import { cn, formatShortRelativeTime, getRepoBranchLabel, getRepoDisplayName } from '@/lib/utils'
import { getSessionPath } from '@/lib/navigation'
import {
  isCurrentSessionItem,
  isRepoReady,
  type SidebarSessionItem,
} from '@/components/navigation/sidebar-session-tree'
import type { Repo } from '@/api/types'

const OPEN_REPO_HEADER_STYLE: CSSProperties = {
  background: 'color-mix(in srgb, var(--color-primary) 15%, var(--color-card))',
}

function OpenRepoRail() {
  return <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
}

interface RepoNavGroupProps {
  name: string
  branch?: string | null
  isWorktree?: boolean
  isOpen: boolean
  isCurrent: boolean
  onOpenRepo: () => void
  onToggle?: () => void
  actions?: ReactNode
  children?: ReactNode
}

export function RepoNavGroup({
  name,
  branch,
  isWorktree,
  isOpen,
  isCurrent,
  onOpenRepo,
  onToggle,
  actions,
  children,
}: RepoNavGroupProps) {
  return (
    <div className="relative">
      <div
        className={cn(
          'relative flex h-[52px] items-stretch border-b border-border bg-card',
          isOpen && 'sticky top-0 z-10',
        )}
        style={isOpen ? OPEN_REPO_HEADER_STYLE : undefined}
      >
        {isOpen && <OpenRepoRail />}
        <button
          type="button"
          onClick={onOpenRepo}
          aria-current={isCurrent ? 'page' : undefined}
          className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pl-4 pr-2 text-left hover:bg-white/[0.03]"
        >
          <span className="truncate text-[15px] font-bold tracking-tight text-orange-600 dark:text-orange-400">
            {name}
          </span>
          {branch && (
            <span
              className={cn(
                'truncate font-mono text-[11.5px]',
                isWorktree ? 'text-purple-400' : 'text-muted-foreground',
              )}
            >
              {branch}
            </span>
          )}
        </button>
        {actions && <div className="flex shrink-0 items-center pr-2">{actions}</div>}
        {onToggle && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`Show sessions in ${name}`}
            onClick={onToggle}
            className="flex w-11 shrink-0 items-center justify-center border-l border-border/60 text-muted-foreground"
          >
            {isOpen ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>
      {isOpen && children && (
        <div className="relative">
          <OpenRepoRail />
          {children}
        </div>
      )}
    </div>
  )
}

interface SessionNavRowProps {
  item: SidebarSessionItem
  isCurrent: boolean
  onSelect: (path: string) => void
  repoLabel?: string
}

export function SessionNavRow({ item, isCurrent, onSelect, repoLabel }: SessionNavRowProps) {
  const { hasForSession: hasPermission } = usePermissions()
  const { hasForSession: hasForm } = useForms()

  return (
    <button
      type="button"
      onClick={() => onSelect(item.path)}
      aria-current={isCurrent ? 'page' : undefined}
      title={item.branchLabel ? `${item.repoLabel} · ${item.branchLabel}` : item.repoLabel}
      className={cn(
        'flex h-9 w-full items-center gap-2 pl-4 pr-3.5 text-left text-[13.5px] text-foreground hover:bg-accent/50',
        isCurrent && 'bg-primary/25 font-semibold',
      )}
    >
      <span className="w-3 shrink-0">
        {item.isPinned && <Pin className="h-3 w-3" aria-label="Pinned" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.session.title || 'Untitled Session'}</span>
      {repoLabel && (
        <span className="max-w-24 shrink-0 truncate text-xs text-orange-600 dark:text-orange-400">{repoLabel}</span>
      )}
      <SessionStatusIndicator sessionID={item.session.id} size="sm" />
      {hasPermission(item.session.id) && (
        <Bell className="h-3 w-3 shrink-0 text-orange-500" aria-label="Pending permission" />
      )}
      {hasForm(item.session.id) && (
        <HelpCircle className="h-3 w-3 shrink-0 text-blue-500" aria-label="Pending form" />
      )}
      <span className="ml-auto min-w-[30px] shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatShortRelativeTime(new Date(item.session.time.updated))}
      </span>
    </button>
  )
}

export function SessionNavStatus({ children }: { children: ReactNode }) {
  return <div className="flex h-10 items-center pl-4 text-xs text-muted-foreground">{children}</div>
}

function SessionNavLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center pl-4 text-left text-xs text-muted-foreground hover:bg-accent/50"
    >
      {children}
    </button>
  )
}

export function SearchClearButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label="Clear search"
      onClick={onClear}
      className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
    >
      <X className="h-4 w-4" />
    </button>
  )
}

interface RepoSessionListProps {
  repo: Repo
  onSelectSession: (path: string) => void
}

function RepoSessionList({ repo, onSelectSession }: RepoSessionListProps) {
  const location = useLocation()
  const repos = useMemo(() => [repo], [repo])
  const { groups, isLoading, isError, hasMore } = useSidebarRepoGroups({ repos })
  const items = groups[0]?.items ?? []

  if (isLoading) return <SessionNavStatus>Loading sessions...</SessionNavStatus>
  if (isError) return <SessionNavStatus>Failed to load sessions</SessionNavStatus>
  if (items.length === 0) return <SessionNavStatus>No sessions</SessionNavStatus>

  return (
    <>
      {items.map((item) => (
        <SessionNavRow
          key={item.key}
          item={item}
          isCurrent={isCurrentSessionItem(item, location.pathname)}
          onSelect={onSelectSession}
        />
      ))}
      {hasMore && (
        <SessionNavLink onClick={() => onSelectSession(`/repos/${repo.id}`)}>All sessions</SessionNavLink>
      )}
    </>
  )
}

interface RepoSessionNavListProps {
  repos: Repo[]
  activeRepoId: number | null
  isVisible: boolean
  onOpenRepo: (repoId: number) => void
  onSelectSession: (path: string) => void
  renderActions?: (repo: Repo) => ReactNode
}

export function RepoSessionNavList({
  repos,
  activeRepoId,
  isVisible,
  onOpenRepo,
  onSelectSession,
  renderActions,
}: RepoSessionNavListProps) {
  const [expandedRepoId, setExpandedRepoId] = useState<number | null>(null)

  useEffect(() => {
    if (isVisible && activeRepoId !== null) setExpandedRepoId(activeRepoId)
  }, [isVisible, activeRepoId])

  return (
    <div className="flex flex-col">
      {repos.map((repo) => {
        const isExpanded = expandedRepoId === repo.id
        const ready = isRepoReady(repo)
        return (
          <RepoNavGroup
            key={repo.id}
            name={getRepoDisplayName(repo)}
            branch={getRepoBranchLabel(repo)}
            isWorktree={repo.isWorktree}
            isOpen={isExpanded}
            isCurrent={repo.id === activeRepoId}
            onOpenRepo={() => onOpenRepo(repo.id)}
            onToggle={() => setExpandedRepoId((current) => (current === repo.id ? null : repo.id))}
            actions={ready ? renderActions?.(repo) : undefined}
          >
            {ready ? (
              <RepoSessionList repo={repo} onSelectSession={onSelectSession} />
            ) : (
              <SessionNavStatus>Repository not ready</SessionNavStatus>
            )}
          </RepoNavGroup>
        )
      })}
    </div>
  )
}

export function NewSessionButton({
  repo,
  onOpenSession,
}: {
  repo: Repo
  onOpenSession: (path: string) => void
}) {
  const createSession = useCreateSession(repo.fullPath, (session) => {
    onOpenSession(getSessionPath(repo.id, session.id))
  })

  return (
    <Button
      type="button"
      size="icon-sm"
      aria-label={`New session in ${getRepoDisplayName(repo)}`}
      onClick={() => createSession.mutate({ agent: undefined })}
    >
      <Plus className="h-3.5 w-3.5" />
    </Button>
  )
}
