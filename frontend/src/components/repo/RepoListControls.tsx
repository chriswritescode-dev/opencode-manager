import { useState } from 'react'
import { Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMobile } from '@/hooks/useMobile'
import type { RepoFilterMode, RepoSortMode } from './repo-list-state'

interface RepoListControlsProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  filterMode: RepoFilterMode
  onFilterModeChange: (mode: RepoFilterMode) => void
  sortMode: RepoSortMode
  onSortModeChange: (mode: RepoSortMode) => void
  filteredCount: number
  attentionCount: number
  selectedCount: number
  allVisibleSelected: boolean
  onSelectAll: () => void
  onClearSelection: () => void
  onDelete: () => void
  hasLocalRepos: boolean
  hasClonedRepos: boolean
}

const FILTER_OPTIONS: { value: RepoFilterMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'recent', label: 'Recent' },
  { value: 'attention', label: 'Changes' },
  { value: 'worktrees', label: 'Worktrees' },
  { value: 'local', label: 'Local' },
]

const SORT_OPTIONS: { value: RepoSortMode; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'manual', label: 'Manual' },
  { value: 'name', label: 'Name' },
]

export function RepoListControls({
  searchQuery,
  onSearchChange,
  filterMode,
  onFilterModeChange,
  sortMode,
  onSortModeChange,
  filteredCount,
  attentionCount,
  selectedCount,
  allVisibleSelected,
  onSelectAll,
  onClearSelection,
  onDelete,
  hasLocalRepos,
  hasClonedRepos,
}: RepoListControlsProps) {
  const isMobile = useMobile()
  const [showMenu, setShowMenu] = useState(false)

  const currentSortLabel = SORT_OPTIONS.find((s) => s.value === sortMode)?.label ?? 'Recent'
  const inSelectionMode = selectedCount > 0

  const getDeleteLabel = () => {
    if (hasLocalRepos && !hasClonedRepos) {
      return 'Unlink'
    }
    return 'Delete'
  }

  if (inSelectionMode) {
    return (
      <div className="px-2 md:px-0">
        <div className="flex items-center gap-2 bg-accent/50 rounded-md p-2">
          <span className="text-sm font-medium text-foreground shrink-0 min-w-[80px]">
            {selectedCount} selected
          </span>
          <Button
            variant="ghost"
            onClick={onSelectAll}
            className="shrink-0 h-9 text-xs"
            size="sm"
          >
            {allVisibleSelected ? 'Unselect All' : 'Select All'}
          </Button>
          <Button
            variant="ghost"
            onClick={onDelete}
            className="shrink-0 h-9 text-xs text-destructive hover:text-destructive"
            size="sm"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            {getDeleteLabel()}
          </Button>
          <Button
            variant="ghost"
            onClick={onClearSelection}
            className="shrink-0 h-9 text-xs ml-auto"
            size="sm"
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-2 md:px-0 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search repositories..."
            className="pl-9 h-9"
          />
        </div>

        {isMobile ? (
          <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {FILTER_OPTIONS.map((option) => {
                const count =
                  option.value === 'attention'
                    ? attentionCount
                    : option.value === 'all'
                      ? filteredCount
                      : undefined

                return (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => {
                      onFilterModeChange(option.value)
                      setShowMenu(false)
                    }}
                    className={filterMode === option.value ? 'bg-accent' : ''}
                  >
                    {option.label}
                    {count !== undefined && count > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {count}
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">{currentSortLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => {
                    onSortModeChange(option.value)
                    setShowMenu(false)
                  }}
                  className={sortMode === option.value ? 'bg-accent' : ''}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!isMobile && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
          {FILTER_OPTIONS.map((option) => {
            const count =
              option.value === 'attention'
                ? attentionCount
                : option.value === 'all'
                  ? filteredCount
                  : undefined

            return (
              <Button
                key={option.value}
                variant={filterMode === option.value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => onFilterModeChange(option.value)}
                className="shrink-0 gap-1.5"
              >
                {option.label}
                {count !== undefined && count > 0 && (
                  <span
                    className={`text-xs ${filterMode === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
                  >
                    {count}
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      )}

      {!isMobile && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {filteredCount} {filteredCount === 1 ? 'repo' : 'repos'}
            {searchQuery && ` matching "${searchQuery}"`}
          </span>
          {attentionCount > 0 && filterMode !== 'attention' && (
            <span>
              {attentionCount} {attentionCount === 1 ? 'needs attention' : 'need attention'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}