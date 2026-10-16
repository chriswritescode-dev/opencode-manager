import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck, CircleX } from 'lucide-react'
import { useActiveWork } from '@/hooks/useActiveWork'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { parseRepoRoute } from '@/lib/navigation'
import { cn, formatShortRelativeTime, getRepoBranchLabel, getRepoDisplayName } from '@/lib/utils'
import {
  ACTIVE_WORK_GROUPS,
  MS_PER_MINUTE,
  formatActivityEmptyMessage,
  type ActiveWorkItem,
} from '@/lib/activeWork'

const UNTITLED_SESSION_TITLE = 'Untitled Session'
const COMPACT_MAX_ITEMS = 5

const FULL_ICON_CLASS = 'h-4 w-4'
const COMPACT_ICON_CLASS = 'h-3.5 w-3.5'

interface ActivityListProps {
  /** Activity window in minutes. */
  minutes: number
  /** Called when a row is chosen; the caller owns navigation so each surface can apply its own history and close rules. */
  onNavigate: (item: ActiveWorkItem) => void
  hideWhenEmpty?: boolean
  title?: string
  /** `compact` renders one flat, single-line list capped at {@link COMPACT_MAX_ITEMS}; `full` renders grouped rows. */
  variant?: 'full' | 'compact'
}

function isCurrentItem(item: ActiveWorkItem, sessionID: string | null, repoID: number | null) {
  return item.repo.id === repoID && item.session.id === sessionID
}

function activityRowClass(isCurrent: boolean, compact: boolean) {
  return cn(
    'flex w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    compact ? 'py-1' : 'py-1.5',
    isCurrent && 'bg-accent',
  )
}

function ActivityStateIcon({ item, iconClassName }: { item: ActiveWorkItem; iconClassName: string }) {
  if (item.state === 'needs-input') {
    return <CircleAlert className={cn(iconClassName, 'text-warning')} aria-hidden="true" />
  }
  if (item.state === 'running') {
    return <SessionStatusIndicator sessionID={item.session.id} size="sm" />
  }
  if (item.outcome === 'failed') {
    return <CircleX className={cn(iconClassName, 'text-destructive')} aria-hidden="true" />
  }
  if (item.outcome === 'succeeded') {
    return <CircleCheck className={cn(iconClassName, 'text-success')} aria-hidden="true" />
  }
  return null
}

interface ActivityRowProps {
  item: ActiveWorkItem
  isCurrent: boolean
  onSelect: (item: ActiveWorkItem) => void
}

function ActivityRow({ item, isCurrent, onSelect }: ActivityRowProps) {
  const branch = item.worktreeBranch ?? getRepoBranchLabel(item.repo)
  const repoLine = branch
    ? `${getRepoDisplayName(item.repo)} · ${branch}`
    : getRepoDisplayName(item.repo)

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      aria-current={isCurrent ? 'true' : undefined}
      className={activityRowClass(isCurrent, false)}
    >
      <span className="flex w-5 shrink-0 items-center justify-center">
        <ActivityStateIcon item={item} iconClassName={FULL_ICON_CLASS} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">
          {item.session.title || UNTITLED_SESSION_TITLE}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{repoLine}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatShortRelativeTime(new Date(item.updatedAt))}
      </span>
    </button>
  )
}

function CompactActivityRow({ item, isCurrent, onSelect }: ActivityRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      aria-current={isCurrent ? 'true' : undefined}
      className={activityRowClass(isCurrent, true)}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <ActivityStateIcon item={item} iconClassName={COMPACT_ICON_CLASS} />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {item.session.title || UNTITLED_SESSION_TITLE}
      </span>
      <span className="max-w-[35%] truncate text-xs text-muted-foreground">
        {getRepoDisplayName(item.repo)}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatShortRelativeTime(new Date(item.updatedAt))}
      </span>
    </button>
  )
}

interface ActivityGroupProps {
  heading: string
  items: ActiveWorkItem[]
  currentSessionID: string | null
  currentRepoId: number | null
  onSelect: (item: ActiveWorkItem) => void
}

function ActivityGroup({ heading, items, currentSessionID, currentRepoId, onSelect }: ActivityGroupProps) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{heading}</h3>
      {items.map((item) => (
        <ActivityRow
          key={item.key}
          item={item}
          isCurrent={isCurrentItem(item, currentSessionID, currentRepoId)}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export function ActivityList({
  minutes,
  onNavigate,
  hideWhenEmpty = false,
  title,
  variant = 'full',
}: ActivityListProps) {
  const location = useLocation()
  const { groups, isLoading, isError } = useActiveWork(minutes * MS_PER_MINUTE)

  const route = parseRepoRoute(location.pathname)

  if (isLoading) {
    if (hideWhenEmpty) return null
    return <p className="p-4 text-sm text-muted-foreground">Loading activity...</p>
  }

  if (isError) {
    if (hideWhenEmpty) return null
    return <p className="p-4 text-sm text-destructive">Couldn&apos;t load activity.</p>
  }

  const isEmpty =
    groups.needsInput.length === 0 && groups.running.length === 0 && groups.recent.length === 0

  if (isEmpty) {
    if (hideWhenEmpty) return null
    return (
      <p className="p-4 text-sm text-muted-foreground">{formatActivityEmptyMessage(minutes)}</p>
    )
  }

  const isCompact = variant === 'compact'
  const compactItems = [...groups.needsInput, ...groups.running, ...groups.recent].slice(
    0,
    COMPACT_MAX_ITEMS,
  )

  return (
    <section
      aria-label={title}
      className={cn('flex flex-col', isCompact ? 'pb-1' : 'pb-2', title && 'border-b border-border')}
    >
      {title && (
        <h2
          className={cn(
            'px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground',
            isCompact ? 'pt-2 pb-0.5' : 'pt-3 pb-1',
          )}
        >
          {title}
        </h2>
      )}
      {isCompact ? (
        compactItems.map((item) => (
          <CompactActivityRow
            key={item.key}
            item={item}
            isCurrent={isCurrentItem(item, route.sessionId, route.repoId)}
            onSelect={onNavigate}
          />
        ))
      ) : (
        <>
          {ACTIVE_WORK_GROUPS.map((group) => (
            <ActivityGroup
              key={group.key}
              heading={group.heading}
              items={groups[group.key]}
              currentSessionID={route.sessionId}
              currentRepoId={route.repoId}
              onSelect={onNavigate}
            />
          ))}
        </>
      )}
    </section>
  )
}
