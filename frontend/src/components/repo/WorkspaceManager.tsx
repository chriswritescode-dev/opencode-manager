import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { ChevronDown, ChevronRight, GitBranch, Trash2 } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'

interface WorkspaceManagerProps {
  workspaces: RepoSibling[]
  onDelete: (workspaceIds: string[]) => void
  isDeleting?: boolean
}

function workspaceLabel(workspace: RepoSibling): string {
  return (
    workspace.currentBranch ||
    workspace.branch ||
    workspace.workspaceName ||
    workspace.workspaceId ||
    'workspace'
  )
}

export function WorkspaceManager({ workspaces, onDelete, isDeleting = false }: WorkspaceManagerProps) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  const selectableIds = useMemo(
    () => workspaces.map((workspace) => workspace.workspaceId).filter((id): id is string => !!id),
    [workspaces],
  )

  if (!workspaces || workspaces.length === 0) return null

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const selectedCount = selected.size

  const toggle = (workspaceId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(workspaceId)
      } else {
        next.delete(workspaceId)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }

  const handleConfirm = () => {
    onDelete(Array.from(selected))
    setSelected(new Set())
    setConfirmOpen(false)
  }

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>Workspaces ({workspaces.length})</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Checkbox checked={allSelected} aria-label="Select all workspaces" />
              <span>{selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}</span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-destructive hover:text-destructive"
              disabled={selectedCount === 0 || isDeleting}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
          </div>

          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {workspaces.map((workspace) => {
              if (!workspace.workspaceId) return null
              const workspaceId = workspace.workspaceId
              const isChecked = selected.has(workspaceId)
              return (
                <label
                  key={workspaceId}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={isChecked}
                    disabled={isDeleting}
                    onCheckedChange={(checked) => toggle(workspaceId, checked === true)}
                    aria-label={`Select workspace ${workspaceLabel(workspace)}`}
                  />
                  <GitBranch className="h-3 w-3 text-purple-400 flex-shrink-0" />
                  <span className="truncate">{workspaceLabel(workspace)}</span>
                  {workspace.fullPath && (
                    <span className="ml-auto truncate text-[10px] text-muted-foreground max-w-[45%]">
                      {workspace.fullPath}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      <DeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
        title={selectedCount === 1 ? 'Delete Workspace' : 'Delete Workspaces'}
        description={
          selectedCount === 1
            ? 'Are you sure you want to delete this OpenCode workspace? This removes the workspace and its sessions in OpenCode.'
            : `Are you sure you want to delete ${selectedCount} OpenCode workspaces? This removes the workspaces and their sessions in OpenCode.`
        }
        isDeleting={isDeleting}
      />
    </div>
  )
}
