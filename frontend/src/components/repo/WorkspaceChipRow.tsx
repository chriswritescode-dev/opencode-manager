import { Button } from '@/components/ui/button'
import { GitBranch, X } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'

interface WorkspaceChipRowProps {
  workspaces: RepoSibling[]
  onDelete: (workspaceId: string) => void
  deletingWorkspaceId?: string
}

export function WorkspaceChipRow({ workspaces, onDelete, deletingWorkspaceId }: WorkspaceChipRowProps) {
  if (!workspaces || workspaces.length === 0) return null

  return (
    <div className="px-4 pt-2 flex-shrink-0 flex flex-wrap gap-2">
      {workspaces.map((workspace) => {
        if (!workspace.workspaceId) return null
        const label = workspace.currentBranch || workspace.branch || workspace.workspaceName || 'workspace'
        const isDeleting = deletingWorkspaceId === workspace.workspaceId
        return (
          <div
            key={workspace.workspaceId}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 pl-2 pr-1 py-0.5 text-xs"
          >
            <GitBranch className="h-3 w-3 text-purple-400" />
            <span className="truncate max-w-[140px]">{label}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              disabled={isDeleting}
              onClick={() => onDelete(workspace.workspaceId!)}
              aria-label={`Delete workspace ${label}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
