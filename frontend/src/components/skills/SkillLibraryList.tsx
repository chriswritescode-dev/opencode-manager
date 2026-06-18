import { useMemo, useState } from 'react'
import { AlertCircle, Loader2, MoreHorizontal, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { SkillFileInfo, SkillScope } from '@opencode-manager/shared'

type SkillFilter = 'all' | SkillScope

interface SkillLibraryAction {
  label: string
  onClick: (skill: SkillFileInfo) => void
  destructive?: boolean
}

interface SkillLibraryListProps {
  isLoading: boolean
  data: SkillFileInfo[] | undefined
  error: Error | null
  primaryAction?: {
    label: string
    onClick: (skill: SkillFileInfo) => void
  }
  rowActions?: SkillLibraryAction[]
  emptyTitle?: string
  emptyHint?: string
  maxHeightClassName?: string
}

const getSkillKey = (skill: SkillFileInfo) => `${skill.scope}-${skill.repoId ?? 'global'}-${skill.name}`

const getScopeLabel = (skill: SkillFileInfo) => {
  if (skill.scope === 'global') return 'Global'
  return skill.repoName ? `Project: ${skill.repoName}` : 'Project'
}

const getCompactScopeLabel = (skill: SkillFileInfo) => skill.scope === 'global' ? 'Global' : 'Project'

const matchesSkillSearch = (skill: SkillFileInfo, search: string) => {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return [skill.name, skill.description, skill.location, skill.repoName]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query))
}

export function SkillLibraryList({
  isLoading,
  data,
  error,
  primaryAction,
  rowActions = [],
  emptyTitle,
  emptyHint,
  maxHeightClassName = 'max-h-[420px]',
}: SkillLibraryListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')

  const counts = useMemo(() => {
    const skills = data ?? []
    return {
      all: skills.length,
      project: skills.filter((skill) => skill.scope === 'project').length,
      global: skills.filter((skill) => skill.scope === 'global').length,
    }
  }, [data])

  const filteredSkills = useMemo(() => {
    return (data ?? [])
      .filter((skill) => filter === 'all' || skill.scope === filter)
      .filter((skill) => matchesSkillSearch(skill, search))
  }, [data, filter, search])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search skills..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <Button type="button" variant={filter === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter('all')}>
            <span>All</span>
            <span>{counts.all}</span>
          </Button>
          <Button type="button" variant={filter === 'project' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter('project')}>
            <span>Project</span>
            <span>{counts.project}</span>
          </Button>
          <Button type="button" variant={filter === 'global' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter('global')}>
            <span>Global</span>
            <span>{counts.global}</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
          <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : error ? (
        <div className="text-center py-6 text-muted-foreground">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50 text-red-500" />
          <p className="text-sm">Failed to load skills</p>
          <p className="text-xs mt-1">{error.message}</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-muted-foreground">
          <p className="text-sm font-medium text-foreground">{emptyTitle || 'No skills available'}</p>
          <p className="text-xs mt-1">{emptyHint || 'Create or install a skill to get started.'}</p>
        </div>
      ) : (
        <div className={`${maxHeightClassName} overflow-y-auto rounded-lg border border-border`}>
          <div className="divide-y divide-border">
            {filteredSkills.map((skill) => (
              <div
                key={getSkillKey(skill)}
                onClick={primaryAction ? () => primaryAction.onClick(skill) : undefined}
                className={`group flex flex-col gap-2 bg-card px-3 py-3 hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-3 ${primaryAction ? 'cursor-pointer' : ''}`}
              >
                <div className="min-w-0 flex-1 self-stretch sm:self-auto">
                  <div className="flex min-w-0 items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-orange-600 dark:text-orange-400">{skill.name}</p>
                    <Badge variant={skill.scope === 'global' ? 'secondary' : 'outline'} className="shrink-0 sm:hidden">
                      {getCompactScopeLabel(skill)}
                    </Badge>
                    <Badge variant={skill.scope === 'global' ? 'secondary' : 'outline'} className="hidden max-w-full truncate sm:inline-flex">
                      {getScopeLabel(skill)}
                    </Badge>
                  </div>
                  {skill.description && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{skill.description}</p>
                  )}
                </div>
                <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:justify-start" onClick={(event) => event.stopPropagation()}>
                  {primaryAction && (
                    <Button type="button" size="sm" onClick={() => primaryAction.onClick(skill)} className="flex-1 sm:flex-none">
                      {primaryAction.label}
                    </Button>
                  )}
                  {rowActions.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${skill.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {rowActions.map((action) => (
                          <DropdownMenuItem
                            key={action.label}
                            onClick={() => action.onClick(skill)}
                            className={action.destructive ? 'text-destructive focus:text-destructive' : undefined}
                          >
                            {action.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
