import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronsUpDown, FolderGit2, LayoutGrid } from 'lucide-react'
import { getRepoDisplayName } from '@/lib/utils'
import { useMobile } from '@/hooks/useMobile'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { Input } from '@/components/ui/input'
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from '@/components/ui/bottom-sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const ALL_REPOS_PATH = '/schedules'

interface ScheduleRepoSwitcherProps {
  repoId?: number
  name: string
}

interface RepoOption {
  key: string
  label: string
  description: string
  path: string
  active: boolean
  isAllRepos: boolean
}

function schedulePath(repoId: number): string {
  return `/repos/${repoId}/schedules`
}

export function ScheduleRepoSwitcher({ repoId, name }: ScheduleRepoSwitcherProps) {
  const navigate = useNavigate()
  const isMobile = useMobile()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { repos } = useNavigableRepos()

  const options = useMemo<RepoOption[]>(() => {
    const allRepos: RepoOption = {
      key: 'all',
      label: 'All repos',
      description: 'Every repository',
      path: ALL_REPOS_PATH,
      active: repoId === undefined,
      isAllRepos: true,
    }
    const repoOptions = repos.map((repo): RepoOption => {
      const label = getRepoDisplayName(repo)
      const localPath = repo.localPath ?? ''
      return {
        key: String(repo.id),
        label,
        description: localPath && localPath !== label ? localPath : '',
        path: schedulePath(repo.id),
        active: repo.id === repoId,
        isAllRepos: false,
      }
    })
    return [allRepos, ...repoOptions]
  }, [repos, repoId])

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) => (
      option.label.toLowerCase().includes(term) || option.description.toLowerCase().includes(term)
    ))
  }, [options, search])

  const close = () => {
    setOpen(false)
    setSearch('')
  }

  const select = (option: RepoOption) => {
    close()
    if (!option.active) navigate(option.path)
  }

  const renderOptionContent = (option: RepoOption) => (
    <>
      {option.isAllRepos ? (
        <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{option.label}</span>
        {option.description && <span className="block truncate text-xs text-muted-foreground">{option.description}</span>}
      </span>
      {option.active && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </>
  )

  const trigger = (onClick?: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Switch repository (${name})`}
      className="group flex min-w-0 items-center gap-1.5 rounded px-1 -mx-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate text-xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">{name}</span>
      <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  )

  if (isMobile) {
    return (
      <>
        {trigger(() => setOpen(true))}
        <BottomSheet isOpen={open} onClose={close} size="fit" ariaLabel="Switch repository">
          <BottomSheetHeader title="Switch repository" className="border-b-0">
            <Input
              type="text"
              placeholder="Search repositories..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              name="schedule-repo-switch"
              className="mt-2"
            />
          </BottomSheetHeader>
          <BottomSheetContent className="px-0 pt-0">
            {filteredOptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-muted-foreground">
                <FolderGit2 className="mb-3 h-12 w-12 opacity-50" />
                <p className="text-sm">No repositories found</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => select(option)}
                    aria-current={option.active ? 'true' : undefined}
                    className="flex items-center gap-3 px-4 py-3 text-left hover:bg-accent"
                  >
                    {renderOptionContent(option)}
                  </button>
                ))}
              </div>
            )}
            <div aria-hidden="true" className="h-16 shrink-0" />
          </BottomSheetContent>
        </BottomSheet>
      </>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DropdownMenuTrigger asChild>{trigger()}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-64 overflow-auto">
        <DropdownMenuLabel>Switch repository</DropdownMenuLabel>
        {options.map((option, index) => (
          <Fragment key={option.key}>
            {index === 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => select(option)} aria-current={option.active ? 'true' : undefined} className="gap-2">
              {renderOptionContent(option)}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
