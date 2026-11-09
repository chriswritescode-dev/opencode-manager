import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitBranch, Layers, Plus } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'

export type WorktreeTabValue = 'repo' | 'workspaces'

interface WorktreeTabsProps {
  workspaces: RepoSibling[]
  value: WorktreeTabValue
  onValueChange: (value: WorktreeTabValue) => void
  baseLabel: string
  onCreateWorkspace?: () => void
}

export function WorktreeTabs({
  workspaces,
  value,
  onValueChange,
  baseLabel,
  onCreateWorkspace,
}: WorktreeTabsProps) {
  const hasWorkspaces = workspaces.length > 0
  const tabClassName =
    'group min-w-0 flex-1 gap-1.5 rounded-t-md rounded-b-none border border-transparent border-b-0 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground data-[state=active]:-mb-px data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none sm:flex-none'
  const activeLabelClassName = 'group-data-[state=active]:text-highlight'

  return (
    <div className="flex-shrink-0">
      <Tabs value={value} onValueChange={(next) => onValueChange(next as WorktreeTabValue)} className="min-w-0">
        <TabsList className="flex h-auto w-full items-end justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 px-4 pt-2">
          <TabsTrigger value="repo" className={tabClassName}>
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className={`min-w-0 truncate ${activeLabelClassName}`}>{baseLabel}</span>
          </TabsTrigger>
          {hasWorkspaces ? (
            <TabsTrigger value="workspaces" className={tabClassName}>
              <Layers className="h-3 w-3 shrink-0 text-primary" />
              <span className={`min-w-0 truncate ${activeLabelClassName}`}>Worktrees</span>
              <span className="shrink-0 rounded-full border border-border bg-card px-1.5 text-[11px] leading-4 text-muted-foreground">
                {workspaces.length}
              </span>
            </TabsTrigger>
          ) : (
            <button
              type="button"
              onClick={onCreateWorkspace}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-t-md rounded-b-none border border-transparent border-b-0 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground sm:flex-none"
            >
              <Layers className="h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0 truncate">Worktree</span>
              <Plus className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        </TabsList>
      </Tabs>
    </div>
  )
}
