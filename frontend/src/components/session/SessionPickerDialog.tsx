import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfDay } from 'date-fns'
import { MoreHorizontal, Pin, PinOff } from 'lucide-react'
import { getOpenCodeLocation } from '@/api/opencode'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { serverScopedKey } from '@/lib/serverScope'
import type { Repo, Session } from '@/api/types'
import { ACTIVE_WORK_GROUPS, MS_PER_MINUTE, formatActivityEmptyMessage } from '@/lib/activeWork'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeleteSessionDialog } from '@/components/session/DeleteSessionDialog'
import { ProjectPickerContent } from '@/components/session/ProjectPickerContent'
import {
  PickerSearchBar,
  optionId,
  usePickerCursor,
  usePickerKeyNav,
} from '@/components/session/usePickerKeyboardNav'
import { partitionSessions } from '@/components/session/session-partition'
import { buildRepoByDirectory } from '@/components/navigation/sidebar-session-tree'
import { useDeleteSession } from '@/hooks/useOpenCode'
import { useActiveWork, useActivityWindowMinutes } from '@/hooks/useActiveWork'
import { useSessionSearch } from '@/hooks/useSessionSearch'
import { useSessionPins, useToggleSessionPin } from '@/hooks/useSessionPins'
import { usePersistentBoolean } from '@/hooks/usePersistentBoolean'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { useShortcutActions } from '@/contexts/KeyboardShortcutsContext'
import { useSettings } from '@/hooks/useSettings'
import { buildPinnedSessionKeys, getSessionKey } from '@/lib/sessionKey'
import { formatShortcutLabel, resolveShortcutBindings } from '@/lib/keyboardShortcuts'
import { cn, formatShortRelativeTime, getRepoDisplayName } from '@/lib/utils'
import { FINE_POINTER_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'

const ALL_PROJECTS_STORAGE_KEY = 'oc:session-picker:all-projects'
const UNTITLED_SESSION_TITLE = 'Untitled Session'
const NEAR_BOTTOM_PX = 240

type SessionPickerTab = 'active' | 'sessions' | 'projects'

const SESSION_PICKER_TABS: SessionPickerTab[] = ['active', 'sessions', 'projects']
const REMOTE_SESSION_PICKER_TABS: SessionPickerTab[] = ['active', 'sessions']

const SESSION_PICKER_TAB_LABELS: Record<SessionPickerTab, string> = {
  active: 'Active',
  sessions: 'Sessions',
  projects: 'Projects',
}

function nextSessionPickerTab(tab: SessionPickerTab, tabs: SessionPickerTab[]): SessionPickerTab {
  const index = tabs.indexOf(tab)
  return tabs[(index + 1) % tabs.length]
}

interface RemotePickerScope {
  serverId: string
  serverName?: string
  projectDirectory?: string
}

interface SessionPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRepo: Repo | undefined
  activeSessionID?: string
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession?: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
  onSelectRepo: (repo: Repo) => void
  /** Set on a linked-server route to list that server's sessions instead of Manager repos. */
  remote?: RemotePickerScope
}

interface SessionPickerRow {
  key: string
  session: Session
  repo?: Repo
  serverId?: string
  serverName?: string
  updatedAt?: number
}

interface SessionPickerSection {
  id: string
  heading: string
  rows: SessionPickerRow[]
}

function buildSections(
  sessions: Session[],
  pinnedKeys: ReadonlySet<string>,
  keyFn: (session: Session) => string,
  resolveRepo?: (session: Session) => Repo | undefined,
): SessionPickerSection[] {
  const { pinned, today, older } = partitionSessions(sessions, pinnedKeys, keyFn)
  const toRows = (group: Session[]): SessionPickerRow[] =>
    group.map((session) => ({ key: keyFn(session), session, repo: resolveRepo?.(session) }))

  const sections: SessionPickerSection[] = []
  const pinnedRows = toRows(pinned)
  if (pinnedRows.length > 0) sections.push({ id: 'pinned', heading: 'Pinned', rows: pinnedRows })
  const todayRows = toRows(today)
  if (todayRows.length > 0) sections.push({ id: 'today', heading: 'Today', rows: todayRows })

  const currentYear = new Date().getFullYear()
  const byDay = new Map<number, SessionPickerRow[]>()
  for (const row of toRows(older)) {
    const day = startOfDay(new Date(row.session.time.updated)).getTime()
    const existing = byDay.get(day)
    if (existing) existing.push(row)
    else byDay.set(day, [row])
  }
  for (const [day, rows] of byDay) {
    const date = new Date(day)
    const heading =
      date.getFullYear() === currentYear ? format(date, 'EEE, MMM d') : format(date, 'EEE, MMM d, yyyy')
    sections.push({ id: `day-${day}`, heading, rows })
  }
  return sections
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function relativeSubpath(base: string, target: string): string {
  const baseSegments = stripTrailingSlashes(base).split('/').filter(Boolean)
  const targetSegments = stripTrailingSlashes(target).split('/').filter(Boolean)
  let common = 0
  while (
    common < baseSegments.length &&
    common < targetSegments.length &&
    baseSegments[common] === targetSegments[common]
  ) {
    common += 1
  }
  const upward = baseSegments.length - common
  const downward = targetSegments.slice(common)
  return [...Array.from({ length: upward }, () => '..'), ...downward].join('/')
}

function sessionRootDirectory(session: Session): string {
  const directory = stripTrailingSlashes(session.location.directory)
  const subpath = session.subpath
  if (!subpath) return directory
  const depth = subpath.split('/').filter(Boolean).length
  let root = directory
  for (let index = 0; index < depth; index += 1) {
    const separator = root.lastIndexOf('/')
    if (separator <= 0) break
    root = root.slice(0, separator)
  }
  return root
}

function isPathInside(base: string, target: string): boolean {
  const normalizedBase = stripTrailingSlashes(base)
  if (target === normalizedBase) return true
  return target.startsWith(`${normalizedBase}/`)
}

function sessionWorktreeLabel(session: Session, canonical: string | undefined): string | undefined {
  if (!canonical) return undefined
  const root = sessionRootDirectory(session)
  if (isPathInside(canonical, root)) return undefined
  const segments = root.split('/').filter(Boolean)
  return segments[segments.length - 1]
}

function SessionPickerGutter({ sessionID, isActive }: { sessionID: string; isActive: boolean }) {
  const status = useSessionStatusForSession(sessionID)
  if (status.type !== 'idle') {
    return (
      <SessionStatusIndicator sessionID={sessionID} size="sm" />
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

interface SessionPickerRowActionsOptions {
  directories: string[]
  activeSessionID?: string
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession?: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
}

interface SessionPickerRowActions {
  pinnedKeys: ReadonlySet<string>
  pendingDeleteKey: string | null
  clearPendingDelete: () => void
  openRow: (row: SessionPickerRow | undefined) => void
  deleteRow: (row: SessionPickerRow | undefined) => void
  handleTogglePin: (row: SessionPickerRow) => void
  handleRequestDelete: (session: Session) => void
  deleteDialogProps: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    onCancel: () => void
    isDeleting: boolean
  }
}

function useSessionPickerRowActions({
  directories,
  activeSessionID,
  onSelectSession,
  onSelectRemoteSession,
  onDeleteActiveSession,
}: SessionPickerRowActionsOptions): SessionPickerRowActions {
  const { data: sessionPins } = useSessionPins()
  const togglePin = useToggleSessionPin()
  const pinnedKeys = useMemo(() => buildPinnedSessionKeys(sessionPins ?? []), [sessionPins])
  const deleteSession = useDeleteSession(directories)
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)

  const clearPendingDelete = useCallback(() => {
    setPendingDeleteKey(null)
  }, [])

  const openRow = useCallback(
    (row: SessionPickerRow | undefined) => {
      if (!row) return
      if (row.serverId) {
        onSelectRemoteSession?.(row.session, row.serverId)
        return
      }
      if (row.repo) onSelectSession(row.session, row.repo)
    },
    [onSelectSession, onSelectRemoteSession],
  )

  const performDelete = useCallback(
    (session: Session) => {
      if (session.id === activeSessionID) onDeleteActiveSession()
      return deleteSession
        .mutateAsync({ id: session.id, directory: session.location.directory })
        .catch(() => undefined)
    },
    [deleteSession, activeSessionID, onDeleteActiveSession],
  )

  const deleteRow = useCallback(
    (row: SessionPickerRow | undefined) => {
      if (!row || row.serverId) return
      if (pendingDeleteKey !== row.key) {
        setPendingDeleteKey(row.key)
        return
      }
      void performDelete(row.session).finally(() => {
        setPendingDeleteKey(null)
      })
    },
    [pendingDeleteKey, performDelete],
  )

  const handleTogglePin = useCallback(
    (row: SessionPickerRow) => {
      if (row.serverId) return
      togglePin.mutate({
        sessionId: row.session.id,
        directory: row.session.location.directory,
        pinned: !pinnedKeys.has(row.key),
      })
    },
    [togglePin, pinnedKeys],
  )

  const handleRequestDelete = useCallback((session: Session) => {
    setSessionToDelete(session)
  }, [])

  const confirmDelete = useCallback(() => {
    if (!sessionToDelete) return
    void performDelete(sessionToDelete).finally(() => {
      setSessionToDelete(null)
    })
  }, [sessionToDelete, performDelete])

  const deleteDialogProps = useMemo(
    () => ({
      open: sessionToDelete !== null,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) setSessionToDelete(null)
      },
      onConfirm: () => {
        void confirmDelete()
      },
      onCancel: () => setSessionToDelete(null),
      isDeleting: deleteSession.isPending,
    }),
    [sessionToDelete, confirmDelete, deleteSession.isPending],
  )

  return {
    pinnedKeys,
    pendingDeleteKey,
    clearPendingDelete,
    openRow,
    deleteRow,
    handleTogglePin,
    handleRequestDelete,
    deleteDialogProps,
  }
}

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

function SessionPickerList({
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

interface SessionPickerContentProps {
  open: boolean
  currentRepo: Repo | undefined
  activeSessionID?: string
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession?: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
  switchHint: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
  hasFinePointer: boolean
}

function SessionPickerContent({
  open,
  currentRepo,
  activeSessionID,
  onSelectSession,
  onSelectRemoteSession,
  onDeleteActiveSession,
  switchHint,
  searchInputRef,
  hasFinePointer,
}: SessionPickerContentProps) {
  const [allProjects, toggleAllProjects] = usePersistentBoolean(ALL_PROJECTS_STORAGE_KEY, false)
  const { repos } = useNavigableRepos()
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionBaseId = useId()

  const repoByDirectory = useMemo(() => {
    const map = buildRepoByDirectory(repos)
    if (currentRepo) map.set(currentRepo.fullPath, currentRepo)
    return map
  }, [repos, currentRepo])

  const serverId = useOpenCodeServerId()
  const locationQuery = useQuery({
    queryKey: serverScopedKey(['opencode', 'location', currentRepo?.fullPath], serverId),
    queryFn: () => getOpenCodeLocation(currentRepo!.fullPath, serverId),
    enabled: !allProjects && Boolean(currentRepo?.fullPath),
    staleTime: 5 * 60 * 1000,
  })

  const location = locationQuery.data
  const locationPending = !allProjects && Boolean(currentRepo?.fullPath) && locationQuery.isPending
  const projectOption = useMemo(() => {
    if (allProjects || !location || location.project.id === 'global') return undefined
    return {
      id: location.project.id,
      subpath: relativeSubpath(location.project.directory, location.directory),
    }
  }, [allProjects, location])

  const directories = useMemo(() => {
    if (allProjects) {
      const paths = repos.map((repo) => repo.fullPath)
      if (currentRepo) paths.push(currentRepo.fullPath)
      return Array.from(new Set(paths))
    }
    if (locationPending) return []
    return currentRepo ? [currentRepo.fullPath] : []
  }, [allProjects, repos, currentRepo, locationPending])

  const {
    query,
    setQuery,
    trimmedQuery,
    filteredSessions,
    isSearchPending,
    isLoading,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    canFetchNextPage,
  } = useSessionSearch(directories, { allDirectories: allProjects, project: projectOption })

  const isPickerLoading = isLoading || locationPending

  const resolveRepo = useCallback(
    (session: Session) => repoByDirectory.get(session.location.directory) ?? currentRepo,
    [repoByDirectory, currentRepo],
  )

  const {
    pinnedKeys,
    pendingDeleteKey,
    clearPendingDelete,
    openRow,
    deleteRow,
    handleTogglePin,
    handleRequestDelete,
    deleteDialogProps,
  } = useSessionPickerRowActions({
    directories,
    activeSessionID,
    onSelectSession,
    onSelectRemoteSession,
    onDeleteActiveSession,
  })

  const sections = useMemo(
    () =>
      buildSections(
        filteredSessions.filter((session) => Boolean(resolveRepo(session))),
        pinnedKeys,
        getSessionKey,
        resolveRepo,
      ),
    [filteredSessions, pinnedKeys, resolveRepo],
  )
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])

  const activeRow = useMemo(
    () => rows.find((row) => row.session.id === activeSessionID),
    [rows, activeSessionID],
  )
  const defaultCursorKey = !trimmedQuery && activeRow ? activeRow.key : rows[0]?.key ?? null

  const {
    rowIndexByKey,
    cursorIndex,
    cursorRow,
    registerRef,
    moveCursor: moveCursorRaw,
    resetCursor,
  } = usePickerCursor(rows, defaultCursorKey)

  const moveCursor = useCallback(
    (index: number) => {
      clearPendingDelete()
      moveCursorRaw(index)
    },
    [clearPendingDelete, moveCursorRaw],
  )

  useEffect(() => {
    resetCursor()
    clearPendingDelete()
  }, [trimmedQuery, allProjects, resetCursor, clearPendingDelete])

  const handleSearchKeyDown = usePickerKeyNav({
    rows,
    cursorIndex,
    cursorRow,
    moveCursor,
    onOpenRow: openRow,
    onDeleteRow: deleteRow,
    onToggleAllProjects: toggleAllProjects,
  })

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
      if (scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX && canFetchNextPage) {
        void fetchNextPage()
      }
    },
    [canFetchNextPage, fetchNextPage],
  )

  useEffect(() => {
    if (!open) return
    const node = listRef.current
    const isNearBottom = node
      ? node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM_PX
      : rows.length === 0
    if (!isLoading && isNearBottom && canFetchNextPage) {
      void fetchNextPage()
    }
  }, [open, isLoading, rows, canFetchNextPage, fetchNextPage])

  const labelFor = useCallback(
    (row: SessionPickerRow) =>
      allProjects ? undefined : sessionWorktreeLabel(row.session, location?.project.canonical),
    [allProjects, location?.project.canonical],
  )

  return (
    <>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <PickerSearchBar
          inputRef={searchInputRef}
          listId={listId}
          open={open}
          activeDescendantId={cursorIndex >= 0 ? optionId(optionBaseId, cursorIndex) : undefined}
          value={query}
          onChange={setQuery}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search sessions..."
          name="session-picker-search"
          trailing={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={allProjects}
              onClick={toggleAllProjects}
              className="h-9 shrink-0"
            >
              {allProjects ? 'All projects' : 'This project'}
              {hasFinePointer && (
                <kbd className="ml-1 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground">
                  Ctrl+A
                </kbd>
              )}
            </Button>
          }
        />

        <SessionPickerList
          listRef={listRef}
          listId={listId}
          optionBaseId={optionBaseId}
          ariaLabel="Sessions"
          sections={sections}
          rows={rows}
          rowIndexByKey={rowIndexByKey}
          cursorIndex={cursorIndex}
          activeSessionID={activeSessionID}
          pinnedKeys={pinnedKeys}
          pendingDeleteKey={pendingDeleteKey}
          showRepo={allProjects}
          labelFor={labelFor}
          emptyState={
            isPickerLoading
              ? 'Loading sessions...'
              : isSearchPending
                ? 'Searching sessions...'
                : trimmedQuery
                  ? 'No sessions found'
                  : 'No sessions yet'
          }
          onOpenRow={openRow}
          onHoverRow={moveCursor}
          onTogglePin={handleTogglePin}
          onRequestDelete={handleRequestDelete}
          registerRef={registerRef}
          onScroll={handleListScroll}
        >
          {isFetchNextPageError && (
            <div className="flex flex-col items-center gap-2 py-4">
              <p className="text-sm text-muted-foreground">Failed to load more sessions</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void fetchNextPage()
                }}
                disabled={isFetchingNextPage}
              >
                Retry
              </Button>
            </div>
          )}
          {isFetchingNextPage && rows.length > 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">Loading more sessions...</div>
          )}
        </SessionPickerList>

        <div className="mt-2 shrink-0 px-4 text-xs text-muted-foreground pointer-coarse:hidden sm:px-0">
          ↑↓ move · Enter open · Ctrl+D delete · Ctrl+A {allProjects ? 'this project' : 'all projects'}
          {switchHint ? ` · ${switchHint} projects` : ''}
        </div>
      </div>

      <DeleteSessionDialog {...deleteDialogProps} />
    </>
  )
}

interface ActivePickerContentProps {
  open: boolean
  activeSessionID?: string
  onSelectSession: (session: Session, repo: Repo) => void
  onSelectRemoteSession?: (session: Session, serverId: string) => void
  onDeleteActiveSession: () => void
  switchHint: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

function ActivePickerContent({
  open,
  activeSessionID,
  onSelectSession,
  onSelectRemoteSession,
  onDeleteActiveSession,
  switchHint,
  searchInputRef,
}: ActivePickerContentProps) {
  const windowMinutes = useActivityWindowMinutes()
  const { groups, isLoading, isError } = useActiveWork(windowMinutes * MS_PER_MINUTE)

  const listId = useId()
  const optionBaseId = useId()

  const [query, setQuery] = useState('')
  const trimmedQuery = query.trim()

  const sections = useMemo(() => {
    const needle = trimmedQuery.toLowerCase()
    return ACTIVE_WORK_GROUPS.flatMap((definition) => {
      const rows: SessionPickerRow[] = []
      for (const item of groups[definition.key]) {
        if (needle && !(item.session.title ?? '').toLowerCase().includes(needle)) continue
        rows.push({
          key: item.key,
          session: item.session,
          repo: item.repo ?? undefined,
          serverId: item.serverId ?? undefined,
          serverName: item.serverName ?? undefined,
          updatedAt: item.updatedAt,
        })
      }
      return rows.length > 0 ? [{ id: definition.key, heading: definition.heading, rows }] : []
    })
  }, [groups, trimmedQuery])

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])
  const activeRow = useMemo(
    () => rows.find((row) => row.session.id === activeSessionID),
    [rows, activeSessionID],
  )
  const defaultCursorKey = !trimmedQuery && activeRow ? activeRow.key : rows[0]?.key ?? null

  const {
    rowIndexByKey,
    cursorIndex,
    cursorRow,
    registerRef,
    moveCursor: moveCursorRaw,
    resetCursor,
  } = usePickerCursor(rows, defaultCursorKey)

  const directories = useMemo(
    () =>
      Array.from(
        new Set(rows.filter((row) => !row.serverId).map((row) => row.session.location.directory)),
      ),
    [rows],
  )

  const {
    pinnedKeys,
    pendingDeleteKey,
    clearPendingDelete,
    openRow,
    deleteRow,
    handleTogglePin,
    handleRequestDelete,
    deleteDialogProps,
  } = useSessionPickerRowActions({
    directories,
    activeSessionID,
    onSelectSession,
    onSelectRemoteSession,
    onDeleteActiveSession,
  })

  const moveCursor = useCallback(
    (index: number) => {
      clearPendingDelete()
      moveCursorRaw(index)
    },
    [clearPendingDelete, moveCursorRaw],
  )

  useEffect(() => {
    resetCursor()
    clearPendingDelete()
  }, [trimmedQuery, resetCursor, clearPendingDelete])

  const handleSearchKeyDown = usePickerKeyNav({
    rows,
    cursorIndex,
    cursorRow,
    moveCursor,
    onOpenRow: openRow,
    onDeleteRow: deleteRow,
  })

  const emptyState = isLoading
    ? 'Loading sessions...'
    : isError
      ? 'Failed to load active sessions'
      : trimmedQuery
        ? 'No sessions found'
        : formatActivityEmptyMessage(windowMinutes)

  return (
    <>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <PickerSearchBar
          inputRef={searchInputRef}
          listId={listId}
          open={open}
          activeDescendantId={cursorIndex >= 0 ? optionId(optionBaseId, cursorIndex) : undefined}
          value={query}
          onChange={setQuery}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search sessions..."
          name="active-picker-search"
        />

        <SessionPickerList
          listId={listId}
          optionBaseId={optionBaseId}
          ariaLabel="Active sessions"
          sections={sections}
          rows={rows}
          rowIndexByKey={rowIndexByKey}
          cursorIndex={cursorIndex}
          activeSessionID={activeSessionID}
          pinnedKeys={pinnedKeys}
          pendingDeleteKey={pendingDeleteKey}
          showRepo
          emptyState={emptyState}
          onOpenRow={openRow}
          onHoverRow={moveCursor}
          onTogglePin={handleTogglePin}
          onRequestDelete={handleRequestDelete}
          registerRef={registerRef}
        />

        <div className="mt-2 shrink-0 px-4 text-xs text-muted-foreground pointer-coarse:hidden sm:px-0">
          ↑↓ move · Enter open · Ctrl+D delete
          {switchHint ? ` · ${switchHint} sessions` : ''}
        </div>
      </div>

      <DeleteSessionDialog {...deleteDialogProps} />
    </>
  )
}

const EMPTY_PINNED_KEYS: ReadonlySet<string> = new Set()

interface RemoteSessionPickerContentProps {
  open: boolean
  serverName?: string
  projectDirectory?: string
  activeSessionID?: string
  onSelectSession: (session: Session) => void
  switchHint: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

function RemoteSessionPickerContent({
  open,
  serverName,
  projectDirectory,
  activeSessionID,
  onSelectSession,
  switchHint,
  searchInputRef,
}: RemoteSessionPickerContentProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionBaseId = useId()

  const {
    query,
    setQuery,
    trimmedQuery,
    filteredSessions,
    isSearchPending,
    isLoading,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    canFetchNextPage,
  } = useSessionSearch(projectDirectory ? [projectDirectory] : [])

  const sections = useMemo(
    () => buildSections(filteredSessions, EMPTY_PINNED_KEYS, getSessionKey),
    [filteredSessions],
  )
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])

  const activeRow = useMemo(
    () => rows.find((row) => row.session.id === activeSessionID),
    [rows, activeSessionID],
  )
  const defaultCursorKey = !trimmedQuery && activeRow ? activeRow.key : rows[0]?.key ?? null

  const {
    rowIndexByKey,
    cursorIndex,
    cursorRow,
    registerRef,
    moveCursor,
    resetCursor,
  } = usePickerCursor(rows, defaultCursorKey)

  const openRow = useCallback(
    (row: SessionPickerRow | undefined) => {
      if (row) onSelectSession(row.session)
    },
    [onSelectSession],
  )

  useEffect(() => {
    resetCursor()
  }, [trimmedQuery, resetCursor])

  const handleSearchKeyDown = usePickerKeyNav({
    rows,
    cursorIndex,
    cursorRow,
    moveCursor,
    onOpenRow: openRow,
  })

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
      if (scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX && canFetchNextPage) {
        void fetchNextPage()
      }
    },
    [canFetchNextPage, fetchNextPage],
  )

  const labelFor = useCallback(() => serverName, [serverName])

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <PickerSearchBar
        inputRef={searchInputRef}
        listId={listId}
        open={open}
        activeDescendantId={cursorIndex >= 0 ? optionId(optionBaseId, cursorIndex) : undefined}
        value={query}
        onChange={setQuery}
        onKeyDown={handleSearchKeyDown}
        placeholder="Search sessions..."
        name="remote-session-picker-search"
      />

      <SessionPickerList
        listRef={listRef}
        listId={listId}
        optionBaseId={optionBaseId}
        ariaLabel="Sessions"
        sections={sections}
        rows={rows}
        rowIndexByKey={rowIndexByKey}
        cursorIndex={cursorIndex}
        activeSessionID={activeSessionID}
        pinnedKeys={EMPTY_PINNED_KEYS}
        pendingDeleteKey={null}
        showRepo={false}
        showRowActions={false}
        labelFor={labelFor}
        emptyState={
          isLoading
            ? 'Loading sessions...'
            : isSearchPending
              ? 'Searching sessions...'
              : trimmedQuery
                ? 'No sessions found'
                : 'No sessions yet'
        }
        onOpenRow={openRow}
        onHoverRow={moveCursor}
        onTogglePin={() => undefined}
        onRequestDelete={() => undefined}
        registerRef={registerRef}
        onScroll={handleListScroll}
      >
        {isFetchNextPageError && (
          <div className="flex flex-col items-center gap-2 py-4">
            <p className="text-sm text-muted-foreground">Failed to load more sessions</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void fetchNextPage()
              }}
              disabled={isFetchingNextPage}
            >
              Retry
            </Button>
          </div>
        )}
        {isFetchingNextPage && rows.length > 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">Loading more sessions...</div>
        )}
      </SessionPickerList>

      <div className="mt-2 shrink-0 px-4 text-xs text-muted-foreground pointer-coarse:hidden sm:px-0">
        ↑↓ move · Enter open
        {switchHint ? ` · ${switchHint} sessions` : ''}
      </div>
    </div>
  )
}

export function SessionPickerDialog({
  open,
  onOpenChange,
  currentRepo,
  activeSessionID,
  onSelectSession,
  onSelectRemoteSession,
  onDeleteActiveSession,
  onSelectRepo,
  remote,
}: SessionPickerDialogProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const activeSearchInputRef = useRef<HTMLInputElement>(null)
  const projectSearchInputRef = useRef<HTMLInputElement>(null)
  const focusSearchAfterSwitchRef = useRef(false)
  const hasFinePointer = useMediaQuery(FINE_POINTER_MEDIA_QUERY)
  const { preferences } = useSettings()
  const switchHint = useMemo(
    () => {
      const bindings = resolveShortcutBindings(preferences)
      return formatShortcutLabel(
        bindings.shortcuts.switchPickerTab,
        bindings.directShortcuts.includes('switchPickerTab'),
        bindings.leaderKey,
      )
    },
    [preferences],
  )
  const isRemote = remote !== undefined
  const pickerTabs = isRemote ? REMOTE_SESSION_PICKER_TABS : SESSION_PICKER_TABS
  const [tab, setTab] = useState<SessionPickerTab>('sessions')
  const [prevOpen, setPrevOpen] = useState(open)

  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setTab('sessions')
  }

  const activeTab: SessionPickerTab = isRemote && tab === 'projects' ? 'sessions' : tab

  const toggleTab = useCallback(() => {
    focusSearchAfterSwitchRef.current = true
    setTab((current) => nextSessionPickerTab(current, pickerTabs))
  }, [pickerTabs])

  useShortcutActions({ switchPickerTab: open ? toggleTab : undefined })

  useEffect(() => {
    if (!open) {
      focusSearchAfterSwitchRef.current = false
      return
    }
    if (!hasFinePointer && !focusSearchAfterSwitchRef.current) return
    const frame = requestAnimationFrame(() => {
      focusSearchAfterSwitchRef.current = false
      if (activeTab === 'projects') projectSearchInputRef.current?.focus()
      else if (activeTab === 'active') activeSearchInputRef.current?.focus()
      else searchInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, activeTab, hasFinePointer])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        mobileFullscreen
        className="flex min-h-0 w-full min-w-0 flex-col gap-0 p-0 sm:h-[70vh] sm:max-w-3xl sm:p-6"
        onEscapeKeyDown={() => onOpenChange(false)}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (hasFinePointer) {
            searchInputRef.current?.focus()
          } else {
            ;(event.currentTarget as HTMLElement).focus()
          }
        }}
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setTab(value as SessionPickerTab)}
          className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-0"
        >
          <div className="shrink-0 px-4 pt-4 sm:px-0 sm:pt-6">
            <DialogTitle className="sr-only">{SESSION_PICKER_TAB_LABELS[activeTab]}</DialogTitle>
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              {isRemote ? null : <TabsTrigger value="projects">Projects</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent
            value="active"
            className="mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col px-0"
          >
            <ActivePickerContent
              open={open}
              activeSessionID={activeSessionID}
              onSelectSession={onSelectSession}
              onSelectRemoteSession={onSelectRemoteSession}
              onDeleteActiveSession={onDeleteActiveSession}
              switchHint={switchHint}
              searchInputRef={activeSearchInputRef}
            />
          </TabsContent>
          <TabsContent
            value="sessions"
            className="mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col px-0"
          >
            {remote ? (
              <RemoteSessionPickerContent
                open={open}
                serverName={remote.serverName}
                projectDirectory={remote.projectDirectory}
                activeSessionID={activeSessionID}
                onSelectSession={(session) => onSelectRemoteSession?.(session, remote.serverId)}
                switchHint={switchHint}
                searchInputRef={searchInputRef}
              />
            ) : (
              <SessionPickerContent
                open={open}
                currentRepo={currentRepo}
                activeSessionID={activeSessionID}
                onSelectSession={onSelectSession}
                onSelectRemoteSession={onSelectRemoteSession}
                onDeleteActiveSession={onDeleteActiveSession}
                switchHint={switchHint}
                searchInputRef={searchInputRef}
                hasFinePointer={hasFinePointer}
              />
            )}
          </TabsContent>
          {isRemote ? null : (
            <TabsContent
              value="projects"
              className="mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col px-0"
            >
              <ProjectPickerContent
                open={open}
                currentRepo={currentRepo}
                onSelectRepo={onSelectRepo}
                switchHint={switchHint}
                searchInputRef={projectSearchInputRef}
              />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
