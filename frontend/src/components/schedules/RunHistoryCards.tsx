import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { History, Loader2, XCircle, CheckCircle2, Ban, ChevronDown } from 'lucide-react'
import type { ScheduleRun } from '@opencode-manager/shared/types'
import { getRunTone } from '@/components/schedules/schedule-utils'
import { RunDetailPanel } from '@/components/schedules/RunDetailPanel'
import { useRepoScheduleRun } from '@/hooks/useSchedules'

interface RunHistoryCardsProps {
  runs: ScheduleRun[] | undefined
  runsLoading: boolean
  onSelectRun: (id: number) => void
  onCancelRun: () => void
  cancelRunPending: boolean
}

export function RunHistoryCards({
  runs,
  runsLoading,
  onSelectRun,
  onCancelRun,
  cancelRunPending,
}: RunHistoryCardsProps) {
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null)
  const [expandedRunRepoId, setExpandedRunRepoId] = useState<number | null>(null)
  const [expandedRunJobId, setExpandedRunJobId] = useState<number | null>(null)

  const { data: runDetail, isLoading } = useRepoScheduleRun(
    expandedRunRepoId ?? undefined,
    expandedRunJobId,
    expandedRunId
  )

  function getRunStatusIcon(status: ScheduleRun['status']) {
    if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
    if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-400" />
    if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    return <Ban className="h-3.5 w-3.5 text-muted-foreground" />
  }

  function handleCardClick(runId: number, repoId: number, jobId: number) {
    if (expandedRunId === runId) {
      setExpandedRunId(null)
      setExpandedRunRepoId(null)
      setExpandedRunJobId(null)
    } else {
      setExpandedRunId(runId)
      setExpandedRunRepoId(repoId)
      setExpandedRunJobId(jobId)
      onSelectRun(runId)
    }
  }

  if (runsLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!runs?.length) {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="text-center">
          <History className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-sm font-medium">No runs yet</p>
          <p className="text-xs text-muted-foreground mt-1">Use Run now to generate the first execution record and log bundle.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 h-full">
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 pb-6 px-2 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        {runs.map((run, index) => {
          const isExpanded = expandedRunId === run.id
          const displayRun = isExpanded && runDetail ? runDetail : run

          return (
            <div
              key={run.id}
              className={`rounded-xl border overflow-hidden transition-all bg-card ${
                isExpanded ? 'border-border/70' : 'border-border/70'
              } ${index === 0 ? 'mt-0' : 'mt-2'}`}
            >
              <button
                type="button"
                onClick={() => handleCardClick(run.id, run.repoId, run.jobId)}
                className="w-full px-3 py-2 text-left flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {getRunStatusIcon(run.status)}
                      <Badge className={getRunTone(run)}>{run.status}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{run.triggerSource}</span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium leading-tight">
                    {run.sessionTitle ?? 'No session recorded'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
                  {run.errorText && (
                    <p className="mt-0.5 truncate text-xs text-red-400/80">{run.errorText}</p>
                  )}
                </div>
                <ChevronDown className={`h-6 w-6 flex-shrink-0 text-muted-foreground transition-transform duration-200 self-start ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
              {isExpanded && (
                <div className="border-t border-border/60 flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                  <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
                    <RunDetailPanel
                      repoId={run.repoId}
                      activeRun={displayRun}
                      selectedRunLoading={isExpanded && isLoading}
                      onCancelRun={onCancelRun}
                      cancelRunPending={cancelRunPending}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
