import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfDay } from 'date-fns'
import { MoreHorizontal, Pin, PinOff, Search } from 'lucide-react'
import { getOpenCodeLocation } from '@/api/opencode'
import type { Repo, Session } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { DeleteSessionDialog } from '@/components/session/DeleteSessionDialog'
import { partitionSessions } from '@/components/session/session-partition'
import { buildRepoByDirectory } from '@/components/navigation/sidebar-session-tree'
import { useDeleteSession } from '@/hooks/useOpenCode'
import { useSessionSearch } from '@/hooks/useSessionSearch'
import { useSessionPins, useToggleSessionPin } from '@/hooks/useSessionPins'
import { usePersistentBoolean } from '@/hooks/usePersistentBoolean'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { buildPinnedSessionKeys, getSessionKey } from '@/lib/sessionKey'
import { cn, formatShortRelativeTime, getRepoDisplayName } from '@/lib/utils'
import { FINE_POINTER_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'

const ALL_PROJECTS_STORAGE_KEY = 'oc:session-picker:all-projects'
const UNTITLED_SESSION_TITLE = 'Untitled Session'
const PAGE_STEP = 10
const NEAR_BOTTOM_PX = 240

interface SessionPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRepo: Repo | undefined
  activeSessionID?: string
  onSelectSession: (session: Session, repo: Repo) => void
  onDeleteActiveSession: () => void
}

interface SessionPickerRow {
  key: string
  session: Session
  repo: Repo
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
  resolveRepo: (session: Session) => Repo | undefined,
): SessionPickerSection[] {
  const { pinned, today, older } = partitionSessions(sessions, pinnedKeys, keyFn)
  const toRows = (group: Session[]): SessionPickerRow[] =>
    group.flatMap((session) => {
      const repo = resolveRepo(session)
      return repo ? [{ key: keyFn(session), session, repo }] : []
    })

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

function optionId(baseId: string, index: number): string {
  return `${baseId}-option-${index}`
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
      <SessionStatusIndicator
        sessionID={sessionID}
        size="sm"
        className="[&>div]:gap-0 [&>div>div]:h-1.5 [&>div>div]:w-px"
      />
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
          {showRepo && <span className="max-w-32 truncate">{getRepoDisplayName(row.repo)}</span>}
          {!showRepo && label && <span className="max-w-32 truncate">{label}</span>}
          <span>{formatShortRelativeTime(new Date(row.session.time.updated))}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center pr-1">
        <DropdownMenu>
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
        </DropdownMenu>
      </div>
    </div>
  )
})

interface SessionPickerContentProps {
  open: boolean
  currentRepo: Repo | undefined
  activeSessionID?: string
  onSelectSession: (session: Session, repo: Repo) => void
  onDeleteActiveSession: () => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  hasFinePointer: boolean
}

function SessionPickerContent({
  open,
  currentRepo,
  activeSessionID,
  onSelectSession,
  onDeleteActiveSession,
  searchInputRef,
  hasFinePointer,
}: SessionPickerContentProps) {
  const [allProjects, toggleAllProjects] = usePersistentBoolean(ALL_PROJECTS_STORAGE_KEY, false)
  const { repos } = useNavigableRepos()
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const listId = useId()
  const optionBaseId = useId()

  const repoByDirectory = useMemo(() => {
    const map = buildRepoByDirectory(repos)
    if (currentRepo) map.set(currentRepo.fullPath, currentRepo)
    return map
  }, [repos, currentRepo])

  const locationQuery = useQuery({
    queryKey: ['opencode', 'location', currentRepo?.fullPath],
    queryFn: () => getOpenCodeLocation(currentRepo!.fullPath),
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

  const { data: sessionPins } = useSessionPins()
  const togglePin = useToggleSessionPin()
  const pinnedKeys = useMemo(() => buildPinnedSessionKeys(sessionPins ?? []), [sessionPins])
  const deleteSession = useDeleteSession(directories)

  const [cursorKey, setCursorKey] = useState<string | null>(null)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null)

  const sections = useMemo(
    () => buildSections(filteredSessions, pinnedKeys, getSessionKey, resolveRepo),
    [filteredSessions, pinnedKeys, resolveRepo],
  )
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])
  const rowIndexByKey = useMemo(
    () => new Map(rows.map((row, index) => [row.key, index])),
    [rows],
  )

  const activeRow = useMemo(
    () => rows.find((row) => row.session.id === activeSessionID),
    [rows, activeSessionID],
  )
  const defaultCursorKey = !trimmedQuery && activeRow ? activeRow.key : rows[0]?.key ?? null
  const cursorIndex = useMemo(() => {
    if (cursorKey) {
      const index = rowIndexByKey.get(cursorKey)
      if (index !== undefined) return index
    }
    return defaultCursorKey ? rowIndexByKey.get(defaultCursorKey) ?? -1 : -1
  }, [cursorKey, rowIndexByKey, defaultCursorKey])
  const cursorRow = cursorIndex >= 0 ? rows[cursorIndex] : undefined

  useEffect(() => {
    setCursorKey(null)
    setPendingDeleteKey(null)
  }, [trimmedQuery, allProjects])

  const setRowRef = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) rowRefs.current.set(key, node)
    else rowRefs.current.delete(key)
  }, [])

  useEffect(() => {
    if (!cursorRow) return
    const node = rowRefs.current.get(cursorRow.key)
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [cursorRow])

  const moveCursor = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return
      setCursorKey(row.key)
      setPendingDeleteKey(null)
    },
    [rows],
  )

  const openRow = useCallback(
    (row: SessionPickerRow | undefined) => {
      if (!row) return
      onSelectSession(row.session, row.repo)
    },
    [onSelectSession],
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
      if (!row) return
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

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return
      if (event.metaKey || event.altKey) return

      const moveBy = (delta: number, wrap: boolean) => {
        if (rows.length === 0) return
        const base = cursorIndex < 0 ? (delta > 0 ? -1 : 0) : cursorIndex
        const raw = base + delta
        const next = wrap ? ((raw % rows.length) + rows.length) % rows.length : Math.max(0, Math.min(rows.length - 1, raw))
        moveCursor(next)
      }

      const key = event.key
      const ctrlKey = event.key.toLowerCase()

      if (key === 'ArrowDown' || (event.ctrlKey && ctrlKey === 'n')) {
        event.preventDefault()
        moveBy(1, true)
        return
      }
      if (key === 'ArrowUp' || (event.ctrlKey && ctrlKey === 'p')) {
        event.preventDefault()
        moveBy(-1, true)
        return
      }
      if (key === 'PageDown') {
        event.preventDefault()
        moveBy(PAGE_STEP, false)
        return
      }
      if (key === 'PageUp') {
        event.preventDefault()
        moveBy(-PAGE_STEP, false)
        return
      }
      if (key === 'Enter') {
        if (!cursorRow) return
        event.preventDefault()
        openRow(cursorRow)
        return
      }
      if (event.ctrlKey && ctrlKey === 'a') {
        event.preventDefault()
        toggleAllProjects()
        return
      }
      if (event.ctrlKey && ctrlKey === 'd') {
        if (!cursorRow) return
        event.preventDefault()
        deleteRow(cursorRow)
      }
    },
    [cursorIndex, rows, moveCursor, cursorRow, openRow, toggleAllProjects, deleteRow],
  )

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

  const handleTogglePin = useCallback(
    (row: SessionPickerRow) => {
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

  return (
    <>
      <DialogTitle className="shrink-0 px-4 pt-4 sm:px-0 sm:pt-6">
        Sessions
        {!allProjects && currentRepo && (
          <span className="font-normal text-muted-foreground"> for {getRepoDisplayName(currentRepo)}</span>
        )}
      </DialogTitle>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 sm:px-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={cursorIndex >= 0 ? optionId(optionBaseId, cursorIndex) : undefined}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search sessions..."
              className="h-9 pl-9"
              autoComplete="off"
              name="session-picker-search"
            />
          </div>
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
        </div>

        <div
          ref={listRef}
          role="listbox"
          id={listId}
          aria-label="Sessions"
          onScroll={handleListScroll}
          className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md"
        >
          {rows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {isPickerLoading
                ? 'Loading sessions...'
                : isSearchPending
                  ? 'Searching sessions...'
                  : trimmedQuery
                    ? 'No sessions found'
                    : 'No sessions yet'}
            </div>
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
                        showRepo={allProjects}
                        label={allProjects ? undefined : sessionWorktreeLabel(row.session, location?.project.canonical)}
                        onOpen={openRow}
                        onHover={moveCursor}
                        onTogglePin={handleTogglePin}
                        onRequestDelete={handleRequestDelete}
                        registerRef={setRowRef}
                      />
                    )
                  })}
                </div>
              ))}
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
            </>
          )}
        </div>

        <div className="mt-2 shrink-0 px-4 text-xs text-muted-foreground pointer-coarse:hidden sm:px-0">
          ↑↓ move · Enter open · Ctrl+D delete · Ctrl+A {allProjects ? 'this project' : 'all projects'}
        </div>
      </div>

      <DeleteSessionDialog
        open={sessionToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSessionToDelete(null)
        }}
        onConfirm={() => {
          void confirmDelete()
        }}
        onCancel={() => setSessionToDelete(null)}
        isDeleting={deleteSession.isPending}
      />
    </>
  )
}

export function SessionPickerDialog({
  open,
  onOpenChange,
  currentRepo,
  activeSessionID,
  onSelectSession,
  onDeleteActiveSession,
}: SessionPickerDialogProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasFinePointer = useMediaQuery(FINE_POINTER_MEDIA_QUERY)

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
        <SessionPickerContent
          open={open}
          currentRepo={currentRepo}
          activeSessionID={activeSessionID}
          onSelectSession={onSelectSession}
          onDeleteActiveSession={onDeleteActiveSession}
          searchInputRef={searchInputRef}
          hasFinePointer={hasFinePointer}
        />
      </DialogContent>
    </Dialog>
  )
}
