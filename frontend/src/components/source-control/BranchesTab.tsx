import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listBranches, switchBranch, GitAuthError, getRepo } from '@/api/repos'
import { fetchGitStatus } from '@/api/git'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Loader2, GitBranch, GitBranchPlus, GitMerge, Check, Plus, AlertCircle, Globe, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import { useGit } from '@/hooks/useGit'
import { GIT_UI_COLORS } from '@/lib/git-status-styles'
import { CreateWorktreeDialog } from '@/components/repo/CreateWorktreeDialog'
import { IntegrateBranchDialog } from '@/components/source-control/IntegrateBranchDialog'
import { invalidateRepoGitCaches, setRepoGitStatusCaches } from '@/lib/queryInvalidation'

interface BranchesTabProps {
  repoId: number
  currentBranch: string
}

interface BranchTarget {
  name: string
  upstream?: string
}

export function BranchesTab({ repoId, currentBranch }: BranchesTabProps) {
  const queryClient = useQueryClient()
  const [newBranchName, setNewBranchName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false)
  const [integrateDialogOpen, setIntegrateDialogOpen] = useState(false)
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [branchToDelete, setBranchToDelete] = useState<BranchTarget | null>(null)
  const [forceDelete, setForceDelete] = useState(false)
  const [deleteRemote, setDeleteRemote] = useState(false)
  const git = useGit(repoId)

  const { data: branches, isLoading, error, refetch } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => listBranches(repoId),
    staleTime: 30000,
  })

  const { data: repo } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId),
    staleTime: 30000,
  })

  const repoUrl = repo?.repoUrl ?? null
  const isRepoWorktree = repo?.isWorktree ?? false

  const filteredBranches = useMemo(() => {
    const allBranches = branches?.branches ?? []
    if (!searchQuery.trim()) return allBranches
    const query = searchQuery.toLowerCase()
    return allBranches.filter((branch) => branch.name.toLowerCase().includes(query))
  }, [branches, searchQuery])

  const switchBranchMutation = useMutation({
    mutationFn: async (branch: string) => {
      const updatedRepo = await switchBranch(repoId, branch)
      const status = await fetchGitStatus(repoId)
      return { updatedRepo, status }
    },
    onSuccess: ({ updatedRepo, status }) => {
      queryClient.setQueryData(['repo', repoId], updatedRepo)
      setRepoGitStatusCaches(queryClient, repoId, status)
      invalidateRepoGitCaches(queryClient, repoId, { invalidateStatus: false })
      refetch()
      showToast.success(`Switched to branch: ${updatedRepo.currentBranch}`)
    },
    onError: (error) => {
      if (error instanceof GitAuthError) {
        showToast.error('Authentication failed. Please update your Git token in Settings.')
      } else {
        showToast.error(error.message || 'Failed to switch branch')
      }
    },
  })

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return

    try {
      await git.createBranch.mutateAsync(newBranchName.trim())
      setNewBranchName('')
      setIsCreating(false)
      refetch()
    } catch {
      // Error handled by mutation
    }
  }

  const startRename = (branch: BranchTarget) => {
    setRenamingBranch(branch.name)
    setRenameValue(branch.name)
  }

  const cancelRename = () => {
    setRenamingBranch(null)
    setRenameValue('')
  }

  const handleRename = async () => {
    const nextName = renameValue.trim()
    if (!renamingBranch || !nextName || nextName === renamingBranch) {
      cancelRename()
      return
    }

    try {
      await git.renameBranch.mutateAsync({ from: renamingBranch, to: nextName })
      cancelRename()
    } catch {
      // Error handled by mutation
    }
  }

  const startDelete = (branch: BranchTarget) => {
    setBranchToDelete({ name: branch.name, upstream: branch.upstream })
    setForceDelete(false)
    setDeleteRemote(false)
  }

  const closeDelete = () => {
    setBranchToDelete(null)
    setForceDelete(false)
    setDeleteRemote(false)
  }

  const handleDelete = async () => {
    if (!branchToDelete) return

    try {
      await git.deleteBranch.mutateAsync({
        name: branchToDelete.name,
        force: forceDelete,
        deleteRemote: branchToDelete.upstream ? deleteRemote : false,
      })
      closeDelete()
    } catch {
      // Error handled by mutation
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Failed to load branches</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  const activeBranch = branches?.branches?.find(b => b.current)?.name || currentBranch
  const hasBranches = (branches?.branches?.length ?? 0) > 0

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex-shrink-0">
        {isCreating ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder="New branch name..."
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              className="h-10 md:h-8 md:text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateBranch()
                if (e.key === 'Escape') {
                  setIsCreating(false)
                  setNewBranchName('')
                }
              }}
            />
            <Button
              size="sm"
              className="h-10 md:h-8"
              onClick={handleCreateBranch}
              disabled={!newBranchName.trim() || git.createBranch.isPending}
            >
              {git.createBranch.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Create'
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-10 md:h-8"
              onClick={() => {
                setIsCreating(false)
                setNewBranchName('')
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {hasBranches && (
              <Input
                placeholder="Search branches..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 md:h-8 md:text-sm flex-1 min-w-0"
              />
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-10 md:h-8 flex-shrink-0"
              onClick={() => setIsCreating(true)}
              title="Create branch"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Branch</span>
            </Button>
            {repoUrl && (
              <Button
                size="sm"
                variant="outline"
                className="h-10 md:h-8 flex-shrink-0"
                onClick={() => setWorktreeDialogOpen(true)}
                title="Create as a separate worktree workspace"
              >
                <GitBranchPlus className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">Worktree</span>
              </Button>
            )}
            {isRepoWorktree && (
              <Button
                size="sm"
                variant="outline"
                className="h-10 md:h-8 flex-shrink-0"
                onClick={() => setIntegrateDialogOpen(true)}
                title="Integrate this worktree branch into another branch"
              >
                <GitMerge className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">Integrate</span>
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto relative">
        {switchBranchMutation.isPending && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {filteredBranches.length > 0 ? (
          <div className="py-1">
            {filteredBranches.map((branch) => {
              const isCurrent = branch.name === activeBranch || branch.name === `remotes/${activeBranch}`
              const isRemote = branch.type === 'remote'
              const checkoutName = isRemote ? branch.name.replace(/^remotes\/[^/]+\//, '') : branch.name

              const isCheckedOutElsewhere = branch.isWorktree && !isCurrent

              const handleClick = () => {
                if (isCurrent || isCheckedOutElsewhere) return
                switchBranchMutation.mutate(checkoutName)
              }

              if (renamingBranch === branch.name) {
                return (
                  <div key={branch.name} className="flex items-center gap-2 px-3 py-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="h-10 md:h-8 md:text-sm flex-1 min-w-0"
                      aria-label={`New name for branch ${renamingBranch}`}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                        if (e.key === 'Escape') cancelRename()
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-10 md:h-8"
                      onClick={handleRename}
                      disabled={!renameValue.trim() || git.renameBranch.isPending}
                    >
                      {git.renameBranch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rename'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={cancelRename}>
                      Cancel
                    </Button>
                  </div>
                )
              }

              return (
                <div
                  key={branch.name}
                  className={cn(
                    'flex items-center gap-1 px-3 py-2 w-full transition-colors',
                    isCurrent && 'bg-highlight/10',
                    isCheckedOutElsewhere ? 'opacity-60' : 'hover:bg-accent/50'
                  )}
                >
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    onClick={handleClick}
                    disabled={isCurrent || isCheckedOutElsewhere || switchBranchMutation.isPending}
                    title={isCheckedOutElsewhere ? 'Branch is checked out in another worktree' : undefined}
                  >
                    {isRemote ? (
                      <Globe className="w-4 h-4 text-info" />
                    ) : (
                      <GitBranch className={cn('w-4 h-4', isCurrent ? GIT_UI_COLORS.current : 'text-muted-foreground')} />
                    )}
                    <span className="flex-1 text-sm truncate">{branch.name}</span>
                    {(isCheckedOutElsewhere || (isCurrent && isRepoWorktree)) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">worktree</span>
                    )}
                    {branch.type === 'local' && !branch.upstream && !branch.isWorktree && !(isCurrent && isRepoWorktree) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">local</span>
                    )}
                    {isCurrent && <Check className={`w-4 h-4 ${GIT_UI_COLORS.current}`} />}
                  </button>
                  {!isRemote && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="p-1 rounded text-muted-foreground hover:bg-accent"
                          aria-label={`Actions for ${branch.name}`}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => startRename(branch)} disabled={isCheckedOutElsewhere}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => startDelete(branch)}
                          disabled={isCurrent || !!branch.isWorktree}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
            {searchQuery.trim() ? (
              <p className="text-sm">No branches match "{searchQuery.trim()}"</p>
            ) : (
              <p className="text-sm">No branches found</p>
            )}
          </div>
        )}
      </div>

      <CreateWorktreeDialog
        open={worktreeDialogOpen}
        onOpenChange={setWorktreeDialogOpen}
        repoId={repoId}
        repoUrl={repoUrl}
        defaultBaseBranch={activeBranch}
      />

      <IntegrateBranchDialog
        open={integrateDialogOpen}
        onOpenChange={setIntegrateDialogOpen}
        repoId={repoId}
        sourceBranch={activeBranch}
      />

      <ConfirmDestructiveDialog
        open={!!branchToDelete}
        onOpenChange={(open) => {
          if (!open) closeDelete()
        }}
        onConfirm={handleDelete}
        onCancel={closeDelete}
        title={`Delete branch "${branchToDelete?.name ?? ''}"?`}
        description="This removes the local branch. This action cannot be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        isPending={git.deleteBranch.isPending}
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={forceDelete}
              onCheckedChange={(checked) => setForceDelete(checked === true)}
            />
            Force delete unmerged branch
          </label>
          {branchToDelete?.upstream && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={deleteRemote}
                onCheckedChange={(checked) => setDeleteRemote(checked === true)}
              />
              Also delete remote branch
            </label>
          )}
        </div>
      </ConfirmDestructiveDialog>
    </div>
  )
}
