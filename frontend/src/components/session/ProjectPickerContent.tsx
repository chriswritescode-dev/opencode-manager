import { useEffect, useId, useMemo, useState } from 'react'
import type { Repo } from '@/api/types'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { LocalRepoNewSessionButton } from '@/components/navigation/RepoSessionNav'
import { isRepoReady } from '@/components/navigation/sidebar-session-tree'
import { cn, getRepoBranchLabel, getRepoDisplayName } from '@/lib/utils'
import {
  PickerSearchBar,
  optionId,
  usePickerCursor,
  usePickerKeyNav,
} from '@/components/session/usePickerKeyboardNav'

interface ProjectPickerContentProps {
  open: boolean
  currentRepo: Repo | undefined
  onSelectRepo: (repo: Repo) => void
  onNavigate: (path: string) => void
  switchHint: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
  searchTrailing?: React.ReactNode
}

interface ProjectPickerRow {
  key: string
  repo: Repo
}

export function ProjectPickerContent({
  open,
  currentRepo,
  onSelectRepo,
  onNavigate,
  switchHint,
  searchInputRef,
  searchTrailing,
}: ProjectPickerContentProps) {
  const { repos, isLoading } = useNavigableRepos()
  const listId = useId()
  const optionBaseId = useId()

  const [query, setQuery] = useState('')

  const trimmedQuery = query.trim()

  const filteredRepos = useMemo(() => {
    const needle = trimmedQuery.toLowerCase()
    if (!needle) return repos
    return repos.filter((repo) => {
      const name = getRepoDisplayName(repo).toLowerCase()
      const branch = (getRepoBranchLabel(repo) ?? '').toLowerCase()
      return name.includes(needle) || branch.includes(needle)
    })
  }, [repos, trimmedQuery])

  const rows = useMemo<ProjectPickerRow[]>(
    () => filteredRepos.map((repo) => ({ key: String(repo.id), repo })),
    [filteredRepos],
  )

  const defaultCursorKey = useMemo(() => {
    if (!trimmedQuery && currentRepo) {
      const current = rows.find((row) => row.repo.id === currentRepo.id)
      if (current) return current.key
    }
    return rows[0]?.key ?? null
  }, [trimmedQuery, currentRepo, rows])

  const { cursorIndex, cursorRow, registerRef, moveCursor, resetCursor } = usePickerCursor(
    rows,
    defaultCursorKey,
  )

  useEffect(() => {
    resetCursor()
  }, [trimmedQuery, resetCursor])

  const handleSearchKeyDown = usePickerKeyNav({
    rows,
    cursorIndex,
    cursorRow,
    moveCursor,
    onOpenRow: (row) => onSelectRepo(row.repo),
  })

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
        placeholder="Search projects..."
        name="project-picker-search"
        trailing={searchTrailing}
      />

      <div
        role="listbox"
        id={listId}
        aria-label="Projects"
        className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md"
      >
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {isLoading ? 'Loading projects...' : 'No projects found'}
          </div>
        ) : (
          rows.map((row, index) => {
            const { repo } = row
            const isCursor = index === cursorIndex
            const isCurrent = repo.id === currentRepo?.id
            const branch = getRepoBranchLabel(repo)
            return (
              <div
                key={row.key}
                ref={(node) => registerRef(row.key, node)}
                role="presentation"
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse') moveCursor(index)
                }}
                className={cn(
                  'group flex items-center rounded-md text-sm min-h-8 pointer-coarse:min-h-11',
                  isCursor ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                <div
                  role="option"
                  id={optionId(optionBaseId, index)}
                  aria-selected={isCursor}
                  onClick={() => onSelectRepo(repo)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2"
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    {isCurrent && <span aria-hidden="true">●</span>}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      isCursor ? 'text-primary-foreground' : isCurrent ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {getRepoDisplayName(repo)}
                  </span>
                  {branch && (
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        isCursor ? 'text-primary-foreground/80' : 'text-muted-foreground',
                      )}
                    >
                      {branch}
                    </span>
                  )}
                </div>
                {isRepoReady(repo) ? (
                  <LocalRepoNewSessionButton repo={repo} onOpenSession={onNavigate} />
                ) : (
                  <span className="shrink-0 pr-2 text-xs text-muted-foreground">Not ready</span>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="mt-2 shrink-0 px-4 text-xs text-muted-foreground pointer-coarse:hidden sm:px-0">
        ↑↓ move · Enter open
        {switchHint ? ` · ${switchHint} active` : ''}
      </div>
    </div>
  )
}
