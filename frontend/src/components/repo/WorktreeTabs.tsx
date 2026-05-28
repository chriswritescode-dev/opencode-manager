import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitBranch, Layers } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'

export type WorktreeTabValue = 'repo' | 'workspaces'

interface WorktreeTabsProps {
  workspaces: RepoSibling[]
  value: WorktreeTabValue
  onValueChange: (value: WorktreeTabValue) => void
  baseLabel: string
}

export function WorktreeTabs({
  workspaces,
  value,
  onValueChange,
  baseLabel,
}: WorktreeTabsProps) {
  if (!workspaces || workspaces.length === 0) return null

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <Tabs value={value} onValueChange={(next) => onValueChange(next as WorktreeTabValue)}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="repo" className="gap-1.5">
            <GitBranch className="h-3 w-3" />
            <span className="truncate max-w-[180px]">{baseLabel}</span>
          </TabsTrigger>
          <TabsTrigger value="workspaces" className="gap-1.5">
            <Layers className="h-3 w-3 text-purple-400" />
            <span>Workspaces</span>
            <span className="text-xs text-muted-foreground">({workspaces.length})</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}
