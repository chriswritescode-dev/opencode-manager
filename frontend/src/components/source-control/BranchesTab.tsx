import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listBranches, switchBranch, GitAuthError } from '@/api/repos'
import { useGitStatus } from '@/api/git'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, GitBranch, Check, Plus, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import { useGit } from '@/hooks/useGit'
import { GIT_UI_COLORS } from '@/lib/git-status-styles'

interface BranchesTabProps {
  repoId: number
  currentBranch: string
}

export function BranchesTab({ repoId, currentBranch }: BranchesTabProps) {
  const queryClient = useQueryClient()
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const git = useGit(repoId)

  const { data: status } = useGitStatus(repoId)

  const { data: branches, isLoading, error, refetch } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => listBranches(repoId),
    staleTime: 30000,
  })

  const switchBranchMutation = useMutation({
    mutationFn: (branch: string) => switchBranch(repoId, branch),
    onSuccess: (updatedRepo) => {
      queryClient.setQueryData(['repo', repoId], updatedRepo)
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      queryClient.invalidateQueries({ queryKey: ['gitStatus', repoId] })
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

  const activeBranch = branches?.current || currentBranch

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border space-y-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Current: {activeBranch}</span>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {status.ahead > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowUp className="w-3 h-3" />{status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowDown className="w-3 h-3" />{status.behind}
                </span>
              )}
            </div>
          )}
        </div>

        {isCreating ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder="New branch name..."
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              className="h-8 text-sm"
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
              className="h-8"
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
              className="h-8"
              onClick={() => {
                setIsCreating(false)
                setNewBranchName('')
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full h-8"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create New Branch
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {branches?.all && branches.all.length > 0 ? (
          <div className="py-1">
            {branches.all.map((branch) => {
              const isCurrent = branch === activeBranch
              const isRemote = branch.startsWith('origin/')

              return (
                <button
                  key={branch}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-accent/50 transition-colors',
                    isCurrent && 'bg-accent'
                  )}
                  onClick={() => !isCurrent && switchBranchMutation.mutate(branch)}
                  disabled={isCurrent || switchBranchMutation.isPending}
                >
                  <GitBranch className={cn(
                    'w-4 h-4',
                    isRemote ? GIT_UI_COLORS.remote : 'text-muted-foreground'
                  )} />
                  <span className="flex-1 text-sm truncate">{branch}</span>
                  {isCurrent && <Check className={`w-4 h-4 ${GIT_UI_COLORS.current}`} />}
                  {switchBranchMutation.isPending && switchBranchMutation.variables === branch && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No branches found</p>
          </div>
        )}
      </div>
    </div>
  )
}
