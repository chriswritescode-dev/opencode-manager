import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import type { UnreadScheduleRun } from '@/api/schedules'

function ScheduleReportRow({ run, rowClassName, onClick }: { run: UnreadScheduleRun; rowClassName?: string; onClick: () => void }) {
  const failed = run.status === 'failed'
  const StatusIcon = failed ? XCircle : CheckCircle2

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent',
        rowClassName,
      )}
    >
      <StatusIcon className={cn('mt-0.5 h-4 w-4 shrink-0', failed ? 'text-destructive' : 'text-success')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-foreground">{run.jobName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDistanceToNow(run.finishedAt ?? run.startedAt, { addSuffix: true })}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{run.repoName}</div>
        {run.preview && (
          <div className={cn('truncate text-xs', failed ? 'text-destructive/80' : 'text-muted-foreground')}>
            {run.preview}
          </div>
        )}
      </div>
    </button>
  )
}

interface ScheduleReportsListProps {
  runs: UnreadScheduleRun[]
  total: number
  rowClassName?: string
  onMarkAllRead: () => void
  markAllPending: boolean
  onNavigate?: () => void
  showTitle?: boolean
  maxHeightClass?: string
}

export function ScheduleReportsList({
  runs,
  total,
  rowClassName,
  onMarkAllRead,
  markAllPending,
  onNavigate,
  showTitle = true,
  maxHeightClass = 'max-h-[60vh]',
}: ScheduleReportsListProps) {
  const navigate = useNavigate()

  const openRun = (runId: number) => {
    onNavigate?.()
    navigate(`/schedules?scheduleTab=runs&runId=${runId}`)
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-baseline gap-2">
          {showTitle && <span className="text-sm font-semibold text-foreground">Reports</span>}
          <span className="text-xs text-muted-foreground">{total} unread</span>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={total === 0 || markAllPending}
          className="text-xs font-medium text-primary transition-colors hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          Mark all read
        </button>
      </div>
      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <p className="text-sm font-medium text-foreground">All caught up</p>
          <p className="text-xs text-muted-foreground">New scheduled reports will show up here.</p>
        </div>
      ) : (
        <div className={cn('overflow-y-auto', maxHeightClass)}>
          {runs.map((run) => (
            <ScheduleReportRow key={run.id} run={run} rowClassName={rowClassName} onClick={() => openRun(run.id)} />
          ))}
        </div>
      )}
      <Link
        to="/schedules?scheduleTab=runs"
        onClick={onNavigate}
        className="block border-t border-border px-3 py-2 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        All runs
      </Link>
    </div>
  )
}
