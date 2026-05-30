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

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <Tabs value={value} onValueChange={(next) => onValueChange(next as WorktreeTabValue)} className="min-w-0">
        <TabsList className="w-full justify-start overflow-hidden">
          <TabsTrigger value="repo" className="min-w-0 flex-1 gap-1.5 px-2 sm:flex-none sm:px-3">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="min-w-0 truncate">{baseLabel}</span>
          </TabsTrigger>
          {hasWorkspaces ? (
            <>
              <TabsTrigger value="workspaces" className="min-w-0 flex-1 gap-1.5 px-2 sm:flex-none sm:px-3" onClick={onWorkspaceMenu}>
                <Layers className="h-3 w-3 shrink-0 text-purple-400" />
                <span className="min-w-0 truncate">{workspaceLabel}</span>
                <span className="shrink-0 text-xs text-muted-foreground">({workspaces.length})</span>
              </TabsTrigger>
            </>
          ) : (
            <button
              type="button"
              onClick={onCreateWorkspace}
              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground sm:flex-none sm:px-3"
            >
              <Layers className="h-3 w-3 shrink-0 text-purple-400" />
              <span className="min-w-0 truncate">Workspace</span>
              <Plus className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        </TabsList>
      </Tabs>
    </div>
  )
}
