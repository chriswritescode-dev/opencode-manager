import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioOptionGroup, type RadioOption } from '@/components/ui/radio-option-group'
import { GitMerge, Loader2 } from 'lucide-react'
import { getRepo, listBranches } from '@/api/repos'
import { getApiErrorMessage, useGitStatus } from '@/api/git'
import { FetchError } from '@/api/fetchWrapper'
import { showToast } from '@/lib/toast'
import { useGit } from '@/hooks/useGit'
import { setRepoGitStatusCaches } from '@/lib/queryInvalidation'
import { GitOperationBanner } from './GitOperationBanner'
import type { GitOperationState } from '@opencode-manager/shared'

type IntegrateStrategy = 'merge' | 'cherry-pick'

const INTEGRATE_STRATEGY_OPTIONS: Array<RadioOption<IntegrateStrategy>> = [
  { value: 'merge', label: 'Merge commit', description: 'Integrate all commits with a merge commit.' },
  { value: 'cherry-pick', label: 'Cherry-pick commits', description: 'Replay each commit onto the target branch.' },
]

const CONFLICT_STATUS_POLL_INTERVAL_MS = 2000

interface IntegrateBranchDialogProps {
  repoId: number
  sourceBranch: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function IntegrateBranchDialog({ repoId, sourceBranch, open, onOpenChange }: IntegrateBranchDialogProps) {
  const queryClient = useQueryClient()
  const git = useGit(repoId)
  const [targetBranch, setTargetBranch] = useState('')
  const [strategy, setStrategy] = useState<IntegrateStrategy>('merge')
  const [conflictTargetRepoId, setConflictTargetRepoId] = useState<number | null>(null)
  const [conflictSnapshot, setConflictSnapshot] = useState<GitOperationState | null>(null)
  const [conflictStartedAt, setConflictStartedAt] = useState(0)

  const { data: repo } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId),
    enabled: open,
    staleTime: 30000,
  })

  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => listBranches(repoId),
    enabled: open,
    staleTime: 30000,
  })

  const { data: targetStatus, dataUpdatedAt: targetStatusUpdatedAt } = useGitStatus(
    conflictTargetRepoId ?? undefined,
    { refetchInterval: conflictTargetRepoId !== null ? CONFLICT_STATUS_POLL_INTERVAL_MS : false }
  )

  const hasFreshTargetStatus = conflictTargetRepoId !== null && targetStatusUpdatedAt >= conflictStartedAt
  const activeOperation = hasFreshTargetStatus ? (targetStatus?.operation ?? null) : conflictSnapshot

  const candidates = useMemo(
    () => (branchesData?.branches ?? []).filter((branch) => branch.type === 'local' && branch.name !== sourceBranch),
    [branchesData, sourceBranch]
  )

  useEffect(() => {
    if (!open) {
      setTargetBranch('')
      setStrategy('merge')
      setConflictTargetRepoId(null)
      setConflictSnapshot(null)
      return
    }
    if (targetBranch && candidates.some((branch) => branch.name === targetBranch)) return
    const preferred = repo?.defaultBranch
    setTargetBranch(candidates.find((branch) => branch.name === preferred)?.name ?? candidates[0]?.name ?? '')
  }, [open, candidates, repo, targetBranch])

  useEffect(() => {
    if (conflictTargetRepoId === null || !hasFreshTargetStatus) return
    if (targetStatus?.operation) return
    setConflictTargetRepoId(null)
    setConflictSnapshot(null)
  }, [conflictTargetRepoId, hasFreshTargetStatus, targetStatus])

  useEffect(() => {
    if (conflictTargetRepoId === null || !hasFreshTargetStatus || !targetStatus) return
    setRepoGitStatusCaches(queryClient, conflictTargetRepoId, targetStatus)
  }, [queryClient, conflictTargetRepoId, hasFreshTargetStatus, targetStatus])

  const handleIntegrate = () => {
    git.integrateBranch.mutate(
      { targetBranch, strategy },
      {
        onSuccess: () => onOpenChange(false),
        onError: (error) => {
          if (error instanceof FetchError && error.code === 'MERGE_CONFLICT') {
            const details = error.details as { targetRepoId?: number; operation?: GitOperationState } | undefined
            if (details?.targetRepoId !== undefined && details.operation) {
              setConflictTargetRepoId(details.targetRepoId)
              setConflictSnapshot(details.operation)
              setConflictStartedAt(Date.now())
              return
            }
          }
          showToast.error(getApiErrorMessage(error))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="w-4 h-4" />
            Integrate {sourceBranch}
          </DialogTitle>
          <DialogDescription>
            Integrate the commits from {sourceBranch} into another checked-out branch.
          </DialogDescription>
        </DialogHeader>

        {conflictTargetRepoId !== null && activeOperation ? (
          <div className="space-y-3">
            <GitOperationBanner repoId={conflictTargetRepoId} operation={activeOperation} />
            <div className="flex justify-end">
              <Button variant="outline" className="border-border hover:bg-accent" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="integrate-target-branch">
                Target branch
              </label>
              <Select value={targetBranch} onValueChange={setTargetBranch} disabled={branchesLoading}>
                <SelectTrigger
                  id="integrate-target-branch"
                  aria-label="Target branch"
                  className="bg-background border-border text-foreground"
                >
                  <SelectValue placeholder={branchesLoading ? 'Loading branches...' : 'Select a target branch'} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {candidates.map((branch) => (
                    <SelectItem key={branch.name} value={branch.name}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!branchesLoading && candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No other local branches are available to integrate into.
                </p>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Strategy</legend>
              <RadioOptionGroup
                name="integrate-strategy"
                value={strategy}
                onChange={setStrategy}
                options={INTEGRATE_STRATEGY_OPTIONS}
              />
            </fieldset>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border hover:bg-accent">
                Cancel
              </Button>
              <Button
                onClick={handleIntegrate}
                disabled={!targetBranch || git.integrateBranch.isPending}
                className="bg-primary hover:bg-primary-hover disabled:opacity-50"
              >
                {git.integrateBranch.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Integrating...
                  </>
                ) : (
                  'Integrate'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
