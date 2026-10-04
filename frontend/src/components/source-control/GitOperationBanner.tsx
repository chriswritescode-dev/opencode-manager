import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useGit } from '@/hooks/useGit'
import { useResolveConflictsWithAgent } from '@/hooks/useResolveConflictsWithAgent'
import { Button } from '@/components/ui/button'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { GitOperationKind, GitOperationState } from '@opencode-manager/shared'

const OPERATION_LABELS: Record<GitOperationKind, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
}

interface GitOperationBannerProps {
  repoId: number
  operation: GitOperationState
}

export function GitOperationBanner({ repoId, operation }: GitOperationBannerProps) {
  const git = useGit(repoId)
  const { data: repo } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId),
  })
  const resolveWithAgent = useResolveConflictsWithAgent({ id: repoId, fullPath: repo?.fullPath ?? '' })
  const [confirmAbort, setConfirmAbort] = useState(false)
  const conflictedFiles = operation.conflictedFiles
  const hasConflicts = conflictedFiles.length > 0
  const label = OPERATION_LABELS[operation.kind]
  const busy = git.continueOperation.isPending || git.abortOperation.isPending || resolveWithAgent.isPending

  const handleAbort = () => {
    git.abortOperation.mutate(undefined, { onSuccess: () => setConfirmAbort(false) })
  }

  const handleResolveWithAgent = () => {
    if (!repo) return
    resolveWithAgent.mutate({ operation, branch: repo.currentBranch ?? repo.branch ?? '' })
  }

  return (
    <div role="alert" className="flex-shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
          <span className="truncate text-sm font-medium">{label} in progress</span>
          {hasConflicts && (
            <span className="text-xs text-muted-foreground">
              {conflictedFiles.length} conflict{conflictedFiles.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {hasConflicts && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={handleResolveWithAgent}
              disabled={!repo || busy}
              title="Open a session that resolves these conflicts with an agent"
            >
              {resolveWithAgent.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Resolve with agent
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setConfirmAbort(true)}
            disabled={busy}
          >
            {git.abortOperation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Abort
          </Button>
          <Button
            size="sm"
            className="h-7 px-2"
            onClick={() => git.continueOperation.mutate()}
            disabled={hasConflicts || busy}
            title={hasConflicts ? 'Resolve all conflicts before continuing' : `Continue the ${operation.kind}`}
          >
            {git.continueOperation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </div>
      </div>
      {hasConflicts && (
        <ul className="mt-1 ml-6 space-y-0.5 text-xs text-muted-foreground">
          {conflictedFiles.map((file) => (
            <li key={file} className="truncate" title={file}>
              {file}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDestructiveDialog
        open={confirmAbort}
        onOpenChange={(open) => {
          if (!open) setConfirmAbort(false)
        }}
        onConfirm={handleAbort}
        onCancel={() => setConfirmAbort(false)}
        title={`Abort ${operation.kind}?`}
        description={`This cancels the ${operation.kind} in progress and restores the previous state.`}
        confirmLabel="Abort"
        pendingLabel="Aborting..."
        isPending={git.abortOperation.isPending}
      />
    </div>
  )
}
