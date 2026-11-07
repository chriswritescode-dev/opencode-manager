import { memo } from 'react'
import { MoreHorizontal, Pin, PinOff } from 'lucide-react'
import type { Repo, Session } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { optionId } from '@/components/session/usePickerKeyboardNav'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { cn, formatShortRelativeTime, getRepoDisplayName } from '@/lib/utils'

const UNTITLED_SESSION_TITLE = 'Untitled Session'

export interface SessionPickerRow {
  key: string
  session: Session
  repo?: Repo
  serverId?: string
  serverName?: string
  updatedAt?: number
}

export interface SessionPickerSection {
  id: string
  heading: string
  rows: SessionPickerRow[]
}

function SessionPickerGutter({ sessionID, isActive }: { sessionID: string; isActive: boolean }) {
  const status = useSessionStatusForSession(sessionID)
  if (status.type !== 'idle') {
    return (
      <SessionStatusIndicator sessionID={sessionID} />
    )
  }
  if (isActive) {
    return <span aria-hidden="true">●</span>
  }
  return null
}

interface SessionPickerRowItemProps {
  row: SessionPickerRow
  index: number
  optionId: string
  isCursor: boolean
  isActive: boolean
  isPinned: boolean
  isPendingDelete: boolean
  showRepo: boolean
  showActions: boolean
  label?: string
  onOpen: (row: SessionPickerRow) => void
  onHover: (index: number) => void
  onTogglePin: (row: SessionPickerRow) => void
  onRequestDelete: (session: Session) => void
  registerRef: (key: string, node: HTMLDivElement | null) => void
}

const SessionPickerRowItem = memo(function SessionPickerRowItem({
  row,
  index,
  optionId,
  isCursor,
  isActive,
  isPinned,
  isPendingDelete,
  showRepo,
  showActions,
  label,
  onOpen,
  onHover,
  onTogglePin,
  onRequestDelete,
  registerRef,
}: SessionPickerRowItemProps) {
  return (
    <div
      ref={(node) => registerRef(row.key, node)}
      role="presentation"
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') onHover(index)
      }}
      className={cn(
        'group flex items-center rounded-md text-sm min-h-8 pointer-coarse:min-h-11',
        isPendingDelete
          ? 'bg-destructive text-destructive-foreground'
          : isCursor
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-accent',
      )}
    >
      <div
        role="option"
        id={optionId}
        aria-selected={isCursor}
        onClick={() => onOpen(row)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          <SessionPickerGutter sessionID={row.session.id} isActive={isActive} />
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            isPendingDelete
              ? 'text-destructive-foreground'
              : isCursor
                ? 'text-primary-foreground'
                : isActive
                  ? 'text-primary'
                  : 'text-foreground',
          )}
        >
          {isPendingDelete ? 'Press Ctrl+D again to confirm' : row.session.title || UNTITLED_SESSION_TITLE}
        </span>
        <span
          className={cn(
            'flex shrink-0 items-center gap-2 text-xs',
            isPendingDelete
              ? 'text-destructive-foreground/80'
              : isCursor
                ? 'text-primary-foreground/80'
                : 'text-muted-foreground',
          )}
        >
          {showRepo && row.repo ? (
            <span className="max-w-32 truncate">{getRepoDisplayName(row.repo)}</span>
          ) : null}
          {showRepo && !row.repo && (row.serverName || row.serverId) ? (
            <span className="max-w-32 truncate">{row.serverName ?? row.serverId}</span>
          ) : null}
          {!showRepo && label && <span className="max-w-32 truncate">{label}</span>}
          <span>{formatShortRelativeTime(new Date(row.updatedAt ?? row.session.time.updated))}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center pr-1">
        {row.serverId || !showActions ? null : <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label="Session actions"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'h-7 w-7 p-0 shrink-0 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:opacity-100',
                isCursor || isPendingDelete ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[200]" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem onClick={() => onTogglePin(row)}>
              {isPinned ? <PinOff className="h-4 w-4 mr-2" /> : <Pin className="h-4 w-4 mr-2" />}
              {isPinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRequestDelete(row.session)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
    </div>
  )
})

interface SessionPickerListProps {
  listId: string
  optionBaseId: string
  ariaLabel: string
  sections: SessionPickerSection[]
  rows: SessionPickerRow[]
  rowIndexByKey: ReadonlyMap<string, number>
  cursorIndex: number
  activeSessionID?: string
  pinnedKeys: ReadonlySet<string>
  pendingDeleteKey: string | null
  showRepo: boolean
  showRowActions?: boolean
  labelFor?: (row: SessionPickerRow) => string | undefined
  emptyState: React.ReactNode
  onOpenRow: (row: SessionPickerRow) => void
  onHoverRow: (index: number) => void
  onTogglePin: (row: SessionPickerRow) => void
  onRequestDelete: (session: Session) => void
  registerRef: (key: string, node: HTMLDivElement | null) => void
  listRef?: React.RefObject<HTMLDivElement | null>
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void
  children?: React.ReactNode
}

export function SessionPickerList({
  listId,
  optionBaseId,
  ariaLabel,
  sections,
  rows,
  rowIndexByKey,
  cursorIndex,
  activeSessionID,
  pinnedKeys,
  pendingDeleteKey,
  showRepo,
  showRowActions = true,
  labelFor,
  emptyState,
  onOpenRow,
  onHoverRow,
  onTogglePin,
  onRequestDelete,
  registerRef,
  listRef,
  onScroll,
  children,
}: SessionPickerListProps) {
  return (
    <div
      ref={listRef}
      role="listbox"
      id={listId}
      aria-label={ariaLabel}
      onScroll={onScroll}
      className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md"
    >
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">{emptyState}</div>
      ) : (
        <>
          {sections.map((section) => (
            <div
              key={section.id}
              role="group"
              aria-labelledby={`${optionBaseId}-heading-${section.id}`}
            >
              <div
                id={`${optionBaseId}-heading-${section.id}`}
                className="pl-8 pr-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground"
              >
                {section.heading}
              </div>
              {section.rows.map((row) => {
                const index = rowIndexByKey.get(row.key) ?? -1
                return (
                  <SessionPickerRowItem
                    key={row.key}
                    row={row}
                    index={index}
                    optionId={optionId(optionBaseId, index)}
                    isCursor={index === cursorIndex}
                    isActive={row.session.id === activeSessionID}
                    isPinned={pinnedKeys.has(row.key)}
                    isPendingDelete={pendingDeleteKey === row.key}
                    showRepo={showRepo}
                    showActions={showRowActions}
                    label={labelFor?.(row)}
                    onOpen={onOpenRow}
                    onHover={onHoverRow}
                    onTogglePin={onTogglePin}
                    onRequestDelete={onRequestDelete}
                    registerRef={registerRef}
                  />
                )
              })}
            </div>
          ))}
          {children}
        </>
      )}
    </div>
  )
}
