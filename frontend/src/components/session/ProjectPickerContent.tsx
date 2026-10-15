import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { Repo } from '@/api/types'
import { Input } from '@/components/ui/input'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { cn, getRepoBranchLabel, getRepoDisplayName } from '@/lib/utils'

const PAGE_STEP = 10

interface ProjectPickerContentProps {
  open: boolean
  currentRepo: Repo | undefined
  onSelectRepo: (repo: Repo) => void
  switchHint: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

function optionId(baseId: string, index: number): string {
  return `${baseId}-option-${index}`
}

export function ProjectPickerContent({
  open,
  currentRepo,
  onSelectRepo,
  switchHint,
  searchInputRef,
}: ProjectPickerContentProps) {
  const { repos, isLoading } = useNavigableRepos()
  const rowRefs = useRef(new Map<number, HTMLDivElement>())
  const listId = useId()
  const optionBaseId = useId()

  const [query, setQuery] = useState('')
  const [cursorIndex, setCursorIndex] = useState<number | null>(null)

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

  const defaultCursorIndex = useMemo(() => {
    if (!trimmedQuery && currentRepo) {
      const index = filteredRepos.findIndex((repo) => repo.id === currentRepo.id)
      if (index >= 0) return index
    }
    return filteredRepos.length > 0 ? 0 : -1
  }, [trimmedQuery, currentRepo, filteredRepos])

  const effectiveCursorIndex = cursorIndex ?? defaultCursorIndex
  const cursorRepo = effectiveCursorIndex >= 0 ? filteredRepos[effectiveCursorIndex] : undefined

  useEffect(() => {
    setCursorIndex(null)
  }, [trimmedQuery])

  const setRowRef = useCallback((key: number, node: HTMLDivElement | null) => {
    if (node) rowRefs.current.set(key, node)
    else rowRefs.current.delete(key)
  }, [])

  useEffect(() => {
    if (!cursorRepo) return
    const node = rowRefs.current.get(cursorRepo.id)
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [cursorRepo])

  const moveCursor = useCallback(
    (index: number) => {
      if (!filteredRepos[index]) return
      setCursorIndex(index)
    },
    [filteredRepos],
  )

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return
      if (event.metaKey || event.altKey) return

      const key = event.key
      const ctrlKey = event.key.toLowerCase()

      const moveBy = (delta: number, wrap: boolean) => {
        if (filteredRepos.length === 0) return
        const base = effectiveCursorIndex < 0 ? (delta > 0 ? -1 : 0) : effectiveCursorIndex
        const raw = base + delta
        const next = wrap
          ? ((raw % filteredRepos.length) + filteredRepos.length) % filteredRepos.length
          : Math.max(0, Math.min(filteredRepos.length - 1, raw))
        moveCursor(next)
      }

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
        if (!cursorRepo) return
        event.preventDefault()
        onSelectRepo(cursorRepo)
      }
    },
    [filteredRepos, effectiveCursorIndex, moveCursor, cursorRepo, onSelectRepo],
  )

  return (
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
            aria-activedescendant={effectiveCursorIndex >= 0 ? optionId(optionBaseId, effectiveCursorIndex) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search projects..."
            className="h-9 pl-9"
            autoComplete="off"
            name="project-picker-search"
          />
        </div>
      </div>

      <div
        role="listbox"
        id={listId}
        aria-label="Projects"
        className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md"
      >
        {filteredRepos.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {isLoading ? 'Loading projects...' : 'No projects found'}
          </div>
        ) : (
          filteredRepos.map((repo, index) => {
            const isCursor = index === effectiveCursorIndex
            const isCurrent = repo.id === currentRepo?.id
            const branch = getRepoBranchLabel(repo)
            return (
              <div
                key={repo.id}
                ref={(node) => setRowRef(repo.id, node)}
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
              </div>
            )
          })
        )}
      </div>

      <div className="mt-2 shrink-0 px-4 text-xs text-muted-foreground pointer-coarse:hidden sm:px-0">
        ↑↓ move · Enter open
        {switchHint ? ` · ${switchHint} sessions` : ''}
      </div>
    </div>
  )
}
