import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, GitBranch, Loader2 } from 'lucide-react'
import { createRepo, listBranches, type CreateRepoOptions } from '@/api/repos'
import { showToast } from '@/lib/toast'
import { invalidateRepoGitCaches } from '@/lib/queryInvalidation'

interface CreateWorktreeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
  repoUrl?: string | null
  defaultBaseBranch?: string
  onCreated?: () => void
}

type WorktreeMode = 'new' | 'existing'

interface WorktreePayload {
  branch: string
  base?: string
}

export function CreateWorktreeDialog({
  open,
  onOpenChange,
  repoId,
  repoUrl,
  defaultBaseBranch,
  onCreated,
}: CreateWorktreeDialogProps) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<WorktreeMode>('new')
  const [branchName, setBranchName] = useState('')
  const [baseBranch, setBaseBranch] = useState<string>('')
  const [existingBranch, setExistingBranch] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const canCreate = Boolean(repoUrl)

  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => listBranches(repoId),
    enabled: open && canCreate,
    staleTime: 30000,
  })

  const localBranches = (branchesData?.branches ?? []).filter((b) => b.type === 'local')

  const seenRemoteNames = new Set<string>()
  const remoteBranches = (branchesData?.branches ?? [])
    .filter((b) => b.type === 'remote' && b.name.startsWith('remotes/origin/'))
    .map((b) => ({ ...b, shortName: b.name.slice('remotes/origin/'.length) }))
    .filter((b) => b.shortName.length > 0)
    .filter((b) => !localBranches.some((lb) => lb.name === b.shortName))
    .filter((b) => {
      if (seenRemoteNames.has(b.shortName)) return false
      seenRemoteNames.add(b.shortName)
      return true
    })

  const checkoutCandidates = [
    ...localBranches
      .filter((b) => !b.current && !b.isWorktree)
      .map((b) => ({ name: b.name, remote: false })),
    ...remoteBranches.map((b) => ({ name: b.shortName, remote: true })),
  ]

  const existingBranchNames = new Set([
    ...localBranches.map((b) => b.name),
    ...remoteBranches.map((b) => b.shortName),
  ])

  const trimmedBranchName = branchName.trim()
  const newBranchConflict =
    mode === 'new' && trimmedBranchName.length > 0 && existingBranchNames.has(trimmedBranchName)

  useEffect(() => {
    if (!open) {
      setMode('new')
      setBranchName('')
      setBaseBranch('')
      setExistingBranch('')
      setError(null)
      return
    }
    if (defaultBaseBranch) {
      setBaseBranch(defaultBaseBranch)
    }
  }, [open, defaultBaseBranch])

  const worktreeMutation = useMutation({
    mutationFn: (payload: WorktreePayload) => {
      const options: CreateRepoOptions = {
        repoUrl: repoUrl || undefined,
        branch: payload.branch,
        useWorktree: true,
      }
      if (payload.base) {
        options.baseBranch = payload.base
      }
      return createRepo(options)
    },
    onSuccess: () => {
      invalidateRepoGitCaches(queryClient, repoId)
      showToast.success('Worktree created')
      onCreated?.()
      onOpenChange(false)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create worktree')
    },
  })

  const handleCreate = () => {
    if (mode === 'existing') {
      if (!existingBranch) {
        setError('Select a branch to check out')
        return
      }
      setError(null)
      worktreeMutation.mutate({ branch: existingBranch })
      return
    }

    if (!trimmedBranchName) {
      setError('Branch name is required')
      return
    }
    if (newBranchConflict) {
      setError('Use Existing branch instead')
      return
    }
    if (!baseBranch) {
      setError('Base branch is required')
      return
    }
    setError(null)
    worktreeMutation.mutate({ branch: trimmedBranchName, base: baseBranch })
  }

  const selectMode = (nextMode: WorktreeMode) => {
    setMode(nextMode)
    setError(null)
  }

  const canSubmit =
    canCreate &&
    !worktreeMutation.isPending &&
    (mode === 'new'
      ? Boolean(trimmedBranchName) && Boolean(baseBranch) && !newBranchConflict
      : Boolean(existingBranch))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Create Worktree
          </DialogTitle>
          <DialogDescription>
            Create a separate workspace for a new or existing branch. The worktree is managed as its own repo entry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!canCreate ? (
            <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded p-3">
              <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-sm text-warning">
                Worktrees can only be created for repositories with a remote URL.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-1">
                <Button
                  type="button"
                  variant={mode === 'new' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={mode === 'new'}
                  onClick={() => selectMode('new')}
                >
                  New branch
                </Button>
                <Button
                  type="button"
                  variant={mode === 'existing' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={mode === 'existing'}
                  onClick={() => selectMode('existing')}
                >
                  Existing branch
                </Button>
              </div>

              {mode === 'new' ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">New branch name</label>
                    <Input
                      placeholder="feature/my-branch"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !worktreeMutation.isPending) handleCreate()
                      }}
                    />
                    {newBranchConflict && (
                      <p className="text-xs text-destructive">Use Existing branch instead</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Base branch</label>
                    <Select value={baseBranch} onValueChange={setBaseBranch} disabled={branchesLoading}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder={branchesLoading ? 'Loading branches...' : 'Select a base branch'} />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {localBranches.length > 0 && (
                          <>
                            {localBranches.map((branch) => (
                              <SelectItem key={`local-${branch.name}`} value={branch.name}>
                                <div className="flex items-center gap-2">
                                  <GitBranch className="w-3.5 h-3.5" />
                                  <span>{branch.name}</span>
                                  {branch.current && (
                                    <span className="text-xs text-muted-foreground">(current)</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </>
                        )}
                        {remoteBranches.map((branch) => (
                          <SelectItem key={`remote-${branch.name}`} value={branch.shortName}>
                            <div className="flex items-center gap-2">
                              <GitBranch className="w-3.5 h-3.5 text-info" />
                              <span>{branch.shortName}</span>
                              <span className="text-xs text-muted-foreground">(remote)</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The new branch will be created from this branch.
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Branch to check out</label>
                  <Select
                    value={existingBranch}
                    onValueChange={setExistingBranch}
                    disabled={branchesLoading}
                  >
                    <SelectTrigger
                      aria-label="Branch to check out"
                      className="bg-background border-border text-foreground"
                    >
                      <SelectValue
                        placeholder={branchesLoading ? 'Loading branches...' : 'Select a branch to check out'}
                      />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {checkoutCandidates.map((branch) => (
                        <SelectItem
                          key={`${branch.remote ? 'remote' : 'local'}-${branch.name}`}
                          value={branch.name}
                        >
                          <div className="flex items-center gap-2">
                            <GitBranch className={`w-3.5 h-3.5${branch.remote ? ' text-info' : ''}`} />
                            <span>{branch.name}</span>
                            {branch.remote && (
                              <span className="text-xs text-muted-foreground">(remote)</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    The worktree will check out the selected branch. Remote branches are limited to origin.
                  </p>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded p-3">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border hover:bg-accent"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!canSubmit}
              className="bg-primary hover:bg-primary-hover disabled:opacity-50"
            >
              {worktreeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Worktree'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
