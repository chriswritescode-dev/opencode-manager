import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitBranch, Layers, Plus } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'
import type { WorktreeTabValue } from '@/hooks/useWorktreeTab'

interface WorktreeTabsProps {
  workspaces: RepoSibling[]
  value: WorktreeTabValue
  onValueChange: (value: WorktreeTabValue) => void
  baseLabel: string
  activeWorkspaceLabel?: string
  onCreateWorkspace?: () => void
  onWorkspaceMenu?: () => void
}

export function WorktreeTabs({
  workspaces,
  value,
  onValueChange,
  baseLabel,
  activeWorkspaceLabel,
  onCreateWorkspace,
  onWorkspaceMenu,
}: WorktreeTabsProps) {
  const hasWorkspaces = workspaces.length > 0
  const workspaceLabel = value === 'workspaces' && activeWorkspaceLabel ? activeWorkspaceLabel : 'Workspaces'
  const tabClassName =
    'group min-w-0 flex-1 gap-1.5 px-2 sm:flex-none sm:px-3 data-[state=active]:border data-[state=active]:border-primary/50 data-[state=active]:bg-primary/10 data-[state=inactive]:hover:bg-accent data-[state=inactive]:hover:text-foreground'
  const activeLabelClassName = 'group-data-[state=active]:text-orange-600 dark:group-data-[state=active]:text-orange-400'

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <Tabs value={value} onValueChange={(next) => onValueChange(next as WorktreeTabValue)} className="min-w-0">
        <TabsList className="w-full justify-start gap-1 overflow-hidden">
          <TabsTrigger value="repo" className={tabClassName}>
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className={`min-w-0 truncate ${activeLabelClassName}`}>{baseLabel}</span>
          </TabsTrigger>
          {hasWorkspaces ? (
            <>
              <TabsTrigger value="workspaces" className={tabClassName} onClick={onWorkspaceMenu}>
                <Layers className="h-3 w-3 shrink-0 text-primary" />
                <span className={`min-w-0 truncate ${activeLabelClassName}`}>{workspaceLabel}</span>
                <span className={`shrink-0 text-xs text-muted-foreground ${activeLabelClassName}`}>({workspaces.length})</span>
              </TabsTrigger>
            </>
          ) : (
            <button
              type="button"
              onClick={onCreateWorkspace}
              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:flex-none sm:px-3"
            >
              <Layers className="h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0 truncate">Workspace</span>
              <Plus className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        </TabsList>
      </Tabs>
    </div>
  )
}
