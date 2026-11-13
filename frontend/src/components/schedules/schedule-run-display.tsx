import { Ban, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { ScheduleRun } from '@opencode-manager/shared/types'
import type { ScheduleRunWithContext } from '@/api/schedules'

export type ScheduleRunRow = ScheduleRun | ScheduleRunWithContext

export function getRunStatusIcon(status: ScheduleRun['status']) {
  if (status === 'completed') return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-success" />
  if (status === 'failed') return <XCircle aria-hidden="true" className="h-3.5 w-3.5 text-destructive" />
  if (status === 'running') return <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-primary" />
  return <Ban aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
}

export function getRunStatusLabel(status: ScheduleRun['status']) {
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'running') return 'Running'
  return 'Cancelled'
}

export function getRunTitle(run: ScheduleRunRow): string {
  if ('jobName' in run) return run.jobName
  return run.sessionTitle ?? 'No session recorded'
}

export function getRunRepoName(run: ScheduleRunRow): string | null {
  return 'repoName' in run ? run.repoName : null
}

export function formatRunBranch(run: ScheduleRunRow): string | null {
  if (!run.runBranch) return null
  return `${run.runBranch}${run.commitHash ? ` @ ${run.commitHash.slice(0, 7)}` : ''}`
}
