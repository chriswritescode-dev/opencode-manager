import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GitBranch, Plus, Search, Trash2 } from 'lucide-react'
import { workspaceLabel, type RepoSibling } from '@/api/repos'

interface WorkspaceManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaces: RepoSibling[]
  onDelete: (workspaceIds: string[]) => void
  activeWorkspaceDirectory?: string
  onActiveWorkspaceChange: (directory: string) => void
  onCreateWorkspace: () => void
  isDeleting?: boolean
}

export function WorkspaceManager({
  open,
  onOpenChange,
  workspaces,
  onDelete,
  activeWorkspaceDirectory,
  onActiveWorkspaceChange,
  onCreateWorkspace,
  isDeleting = false,
}: WorkspaceManagerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [manageMode, setManageMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
    }
  }, [open])

  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return workspaces

    return workspaces.filter((workspace) => {
      const haystack = [
        workspaceLabel(workspace),
        workspace.fullPath,
        workspace.workspaceName,
        workspace.workspaceId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [searchQuery, workspaces])

  const selectableIds = useMemo(
    () => filteredWorkspaces.map((workspace) => workspace.workspaceId).filter((id): id is string => !!id),
    [filteredWorkspaces],
  )

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
    setManageMode(false)
    setConfirmOpen(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen className="flex flex-col gap-0 overflow-hidden p-0 sm:max-h-[85vh] sm:max-w-[560px]">
          <DialogHeader className="border-b border-border px-4 py-4">
            <DialogTitle>Workspaces</DialogTitle>
            <DialogDescription>Choose where new sessions should start.</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
            {manageMode ? (
              <div className="flex items-center gap-2">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all workspaces" />
                <span className="text-xs text-muted-foreground">
                  {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                {activeWorkspaceDirectory ? 'Selected workspace' : 'Select a workspace'}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => {
                  onOpenChange(false)
                  onCreateWorkspace()
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                New
              </Button>
              {manageMode ? (
                <>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      setSelected(new Set())
                      setManageMode(false)
                    }}
                  >
                    Done
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => setManageMode(true)}
                >
                  Manage
                </Button>
              )}
            </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search workspaces..."
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {filteredWorkspaces.map((workspace) => {
              if (!workspace.workspaceId) return null
              const workspaceId = workspace.workspaceId
              const isChecked = selected.has(workspaceId)
              const isActive = !!workspace.fullPath && workspace.fullPath === activeWorkspaceDirectory
              const label = workspaceLabel(workspace)
              const rowClassName = isActive
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border bg-muted/30 hover:bg-muted/50'
              if (!manageMode) {
                return (
                  <button
                    key={workspaceId}
                    type="button"
                    disabled={!workspace.fullPath}
                    onClick={() => {
                      if (!workspace.fullPath) return
                      onActiveWorkspaceChange(workspace.fullPath)
                      onOpenChange(false)
                    }}
                    className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm text-left ${rowClassName}`}
                    aria-pressed={isActive}
                  >
                    <GitBranch className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className={isActive ? 'truncate text-orange-600 dark:text-orange-400' : 'truncate'}>{label}</span>
                    {isActive && <span className="text-xs text-orange-600 dark:text-orange-400">Selected</span>}
                    {workspace.fullPath && (
                      <span className="ml-auto hidden truncate text-xs text-muted-foreground md:block md:max-w-[45%]">
                        {workspace.fullPath}
                      </span>
                    )}
                  </button>
                )
              }
              return (
                <div
                  key={workspaceId}
                  className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={isChecked}
                    disabled={isDeleting}
                    onCheckedChange={(checked) => toggle(workspaceId, checked === true)}
                    aria-label={`Select workspace ${label}`}
                  />
                  <GitBranch className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span className="truncate">{label}</span>
                  {workspace.fullPath && (
                    <span className="ml-auto hidden truncate text-xs text-muted-foreground md:block md:max-w-[45%]">
                      {workspace.fullPath}
                    </span>
                  )}
                </div>
              )
            })}
            {filteredWorkspaces.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No workspaces found
              </div>
            )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </>
  )
}
