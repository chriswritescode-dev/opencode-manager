import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { listRepos } from '@/api/repos'
import { Loader2, Plus } from 'lucide-react'
import type { CreateSessionInput } from '@opencode-manager/shared'

interface CreateSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CreateSessionInput) => Promise<void> | void
  isCreating: boolean
}

export function CreateSessionDialog({
  open,
  onOpenChange,
  onSubmit,
  isCreating,
}: CreateSessionDialogProps) {
  const { data: repos, isLoading: reposLoading } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: open,
  })

  const [name, setName] = useState('')
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set())
  const [devcontainerTemplate, setDevcontainerTemplate] = useState('minimal')

  const handleSubmit = () => {
    if (!name.trim() || selectedRepos.size === 0) {
      return
    }

    const data: CreateSessionInput = {
      name: name.trim(),
      repos: Array.from(selectedRepos).map(repoId => ({ repoId })),
      devcontainerTemplate,
    }

    onSubmit(data)
    
    setName('')
    setSelectedRepos(new Set())
    setDevcontainerTemplate('minimal')
  }

  const toggleRepo = (repoId: number) => {
    const newSelected = new Set(selectedRepos)
    if (newSelected.has(repoId)) {
      newSelected.delete(repoId)
    } else {
      newSelected.add(repoId)
    }
    setSelectedRepos(newSelected)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Create New Workspace</DialogTitle>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="session-name">Workspace Name</Label>
            <Input
              id="session-name"
              placeholder="My Development Workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isCreating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="devcontainer-template">Workspace Template</Label>
            <Input
              id="devcontainer-template"
              placeholder="minimal"
              value={devcontainerTemplate}
              onChange={(e) => setDevcontainerTemplate(e.target.value)}
              disabled={isCreating}
            />
            <p className="text-xs text-muted-foreground">
              Used when starting the workspace. Available: minimal, nodejs, nodejs-fullstack, python, rust
            </p>
          </div>

          <div className="space-y-2">
            <Label>Select Repositories</Label>
            {reposLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : !repos || repos.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">
                No repositories found. Add a repository first.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-3">
                {repos.map((repo) => (
                  <label
                    key={repo.id}
                    className="flex items-center gap-2 p-2 hover:bg-accent rounded cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedRepos.has(repo.id)}
                      onCheckedChange={() => toggleRepo(repo.id)}
                      disabled={isCreating}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {repo.repoUrl || repo.localPath}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Branch: {repo.currentBranch || repo.branch || 'main'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Selected: {selectedRepos.size} repository(ies)
            </p>
          </div>

        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isCreating || !name.trim() || selectedRepos.size === 0}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating workspace...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Create Workspace
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
