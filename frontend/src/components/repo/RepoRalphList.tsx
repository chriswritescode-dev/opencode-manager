import { Loader2, CheckCircle2, XCircle, Ban, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { RalphLoopState } from '@/api/memory'

interface RepoRalphListProps {
  isLoading: boolean
  data: RalphLoopState[] | undefined
  error: Error | null
  onCancel: (sessionId: string) => void
  cancelPending: boolean
}

function StatusIcon({ loop }: { loop: RalphLoopState }) {
  if (loop.active) return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
  if (loop.terminationReason === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-400" />
  if (loop.terminationReason === 'cancelled' || loop.terminationReason === 'user_aborted') return <Ban className="h-4 w-4 text-yellow-400" />
  return <XCircle className="h-4 w-4 text-red-400" />
}

function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function RepoRalphList({ isLoading, data, error, onCancel, cancelPending }: RepoRalphListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-6 text-destructive">
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">Failed to load Ralph status</span>
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
        <span className="text-sm">No Ralph loops found</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto">
      {data.map((loop) => (
        <div key={loop.sessionId} className="rounded-lg border bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StatusIcon loop={loop} />
              <span className="font-medium text-sm truncate">{loop.worktreeName}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-xs capitalize">
                {loop.phase}
              </Badge>
              {loop.active && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onCancel(loop.sessionId)}
                  disabled={cancelPending}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Iteration {loop.iteration}/{loop.maxIterations}</span>
            <span>{formatDuration(loop.startedAt, loop.completedAt)}</span>
            {loop.worktreeBranch && <span className="truncate">{loop.worktreeBranch}</span>}
          </div>
          {loop.terminationReason && !loop.active && (
            <span className="text-xs text-muted-foreground capitalize">
              {loop.terminationReason.replace(/_/g, ' ')}
            </span>
          )}
          {loop.lastAuditResult && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{loop.lastAuditResult}</p>
          )}
        </div>
      ))}
    </div>
  )
}
