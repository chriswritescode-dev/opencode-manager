import { useMemo, useState } from 'react'
import type { CreateScheduleJobRequest, ScheduleJob } from '@opencode-manager/shared/types'
import type { ScheduleServerTarget } from '@/api/schedules'
import {
  useAllSchedules,
  useCancelServerScheduleRun,
  useClearServerScheduleRuns,
  useCreateServerSchedule,
  useDeleteServerSchedule,
  useDeleteServerScheduleRun,
  useRunServerSchedule,
  useServerSchedule,
  useServerScheduleRuns,
  useUpdateServerSchedule,
} from '@/hooks/useSchedules'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { CalendarClock, Loader2, Plus } from 'lucide-react'
import {
  JobDetailTab,
  RunHistoryTab,
  ScheduleJobDialog,
  ScheduleJobsTable,
  ScheduleListToolbar,
  ScheduleRunRemovalDialog,
  ScheduleTabMenu,
} from '@/components/schedules'
import { DELETE_SCHEDULE_DESCRIPTION, matchesScheduleJobSearch, toUpdateScheduleRequest } from './schedule-utils'

type ServerScheduleTab = 'jobs' | 'detail' | 'runs'
type ServerScheduleDialog = 'new' | 'edit' | 'delete' | null

interface ServerSchedulesContentProps {
  target: ScheduleServerTarget
}

/**
 * Schedule jobs, job detail and run history for a project directory on a linked
 * OpenCode server. Remote runs execute in place, so worktree controls are absent.
 */
export function ServerSchedulesContent({ target }: ServerSchedulesContentProps) {
  const { serverId, directory } = target
  const [tab, setTab] = useState<ServerScheduleTab>('jobs')
  const [jobId, setJobId] = useState<number | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<ServerScheduleDialog>(null)
  const [search, setSearch] = useState('')
  const [clearRunsOpen, setClearRunsOpen] = useState(false)
  const [runToDelete, setRunToDelete] = useState<number | null>(null)

  const { data: allSchedules, isLoading } = useAllSchedules()
  const jobs = useMemo(
    () => allSchedules?.filter((job) => job.serverId === serverId && job.directory === directory),
    [allSchedules, directory, serverId],
  )
  const selectedJob = useMemo(
    () => jobs?.find((job) => job.id === jobId),
    [jobs, jobId],
  )
  const { data: fetchedJob, isFetching: isJobFetching } = useServerSchedule(serverId, jobId)
  const { data: runs, isLoading: runsLoading } = useServerScheduleRuns(serverId, jobId, 30)

  const createMutation = useCreateServerSchedule(serverId)
  const updateMutation = useUpdateServerSchedule(serverId)
  const deleteMutation = useDeleteServerSchedule(serverId)
  const runMutation = useRunServerSchedule(serverId)
  const cancelRunMutation = useCancelServerScheduleRun(serverId)
  const clearRunsMutation = useClearServerScheduleRuns(serverId)
  const deleteRunMutation = useDeleteServerScheduleRun(serverId)

  const visibleJobs = useMemo(
    () => (jobs ?? []).filter((job) => matchesScheduleJobSearch(job, search)),
    [jobs, search],
  )
  const clearableRuns = useMemo(() => (runs ?? []).filter((run) => run.status !== 'running'), [runs])
  const runningRun = useMemo(() => runs?.find((run) => run.status === 'running') ?? null, [runs])
  const activeJob = selectedJob ?? fetchedJob
  const editingJob = dialog === 'edit' ? selectedJob : undefined

  const openJob = (job: ScheduleJob) => {
    setJobId(job.id)
    setTab('detail')
  }

  const handleCreate = (data: CreateScheduleJobRequest) => {
    createMutation.mutate({ ...data, directory }, {
      onSuccess: (job) => {
        setDialog(null)
        setJobId(job.id)
        setTab('detail')
      },
    })
  }

  const handleUpdate = (data: CreateScheduleJobRequest) => {
    if (dialog !== 'edit' || jobId === null) return
    updateMutation.mutate({ jobId, data: toUpdateScheduleRequest(data) }, {
      onSuccess: () => setDialog(null),
    })
  }

  const handleDelete = () => {
    if (dialog !== 'delete' || jobId === null) return
    deleteMutation.mutate(jobId, {
      onSuccess: () => {
        setDialog(null)
        setJobId(null)
        setTab('jobs')
      },
    })
  }

  const handleToggleEnabled = (job: ScheduleJob) => {
    updateMutation.mutate({ jobId: job.id, data: { enabled: !job.enabled } })
  }

  const handleRunNow = (job: ScheduleJob) => {
    runMutation.mutate(job.id, {
      onSuccess: (run) => {
        setTab('runs')
        setRunId(run.id)
      },
    })
  }

  const handleCancelRun = () => {
    const run = runId !== null ? runs?.find((entry) => entry.id === runId) : null
    if (!run || run.status !== 'running') return
    cancelRunMutation.mutate({ jobId: run.jobId, runId: run.id })
  }

  const handleCancelJobRun = (job: ScheduleJob) => {
    const lastRun = jobs?.find((entry) => entry.id === job.id)?.lastRun
    if (!lastRun) return
    cancelRunMutation.mutate({ jobId: job.id, runId: lastRun.id })
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hasJobs = (jobs?.length ?? 0) > 0

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!hasJobs ? (
          <Card className="border-dashed border-border/70">
            <CardContent className="flex flex-col items-start gap-4 p-6">
              <div className="rounded-full border border-border bg-muted/40 p-3">
                <CalendarClock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <p className="text-xl font-semibold tracking-tight">No schedules yet</p>
                <p className="text-sm text-muted-foreground">
                  Create a schedule for this remote project to automate recurring agent work in {directory}.
                </p>
              </div>
              <Button onClick={() => setDialog('new')}>
                <Plus className="mr-2 h-4 w-4" />
                Create First Schedule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {tab === 'jobs' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ScheduleListToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search jobs">
                  <Button onClick={() => setDialog('new')} size="sm" className="h-9 shrink-0">
                    <Plus className="mr-1 h-4 w-4" />
                    New Schedule
                  </Button>
                </ScheduleListToolbar>
                <div className="min-h-0 flex-1 overflow-auto pt-2">
                  <div className="min-h-0 overflow-auto rounded-lg border border-border/70">
                    <ScheduleJobsTable
                      jobs={visibleJobs}
                      showRepo={false}
                      selectedJobId={jobId}
                      onOpen={openJob}
                      onRunNow={handleRunNow}
                      onToggleEnabled={handleToggleEnabled}
                      onEdit={(job) => { setJobId(job.id); setDialog('edit') }}
                      onDelete={(job) => { setJobId(job.id); setDialog('delete') }}
                      onCancelRun={handleCancelJobRun}
                      runPending={runMutation.isPending}
                      cancelPending={cancelRunMutation.isPending}
                    />
                  </div>
                </div>
              </div>
            )}
            {tab === 'detail' && (
              <JobDetailTab
                selectedJob={activeJob}
                onEdit={(job) => { setJobId(job.id); setDialog('edit') }}
                onDelete={(id) => { setJobId(id); setDialog('delete') }}
                onToggleEnabled={() => { if (activeJob) handleToggleEnabled(activeJob) }}
                onRunNow={() => { if (activeJob) handleRunNow(activeJob) }}
                updatePending={updateMutation.isPending}
                runPending={runMutation.isPending}
                runningRun={Boolean(runningRun)}
                isJobFetching={isJobFetching}
              />
            )}
            {tab === 'runs' && (
              <RunHistoryTab
                selectedJob={activeJob}
                runs={runs}
                runsLoading={runsLoading}
                runId={runId}
                onSelectRun={setRunId}
                onCancelRun={handleCancelRun}
                cancelRunPending={cancelRunMutation.isPending}
                onClearHistory={() => setClearRunsOpen(true)}
                clearHistoryPending={clearRunsMutation.isPending}
                onDeleteRun={setRunToDelete}
                deleteRunPending={deleteRunMutation.isPending}
              />
            )}
          </>
        )}
      </div>

      {hasJobs && (
        <ScheduleTabMenu activeTab={tab} onTabChange={setTab} />
      )}

      <ScheduleJobDialog
        open={dialog === 'new' || dialog === 'edit'}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        job={editingJob}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSubmit={dialog === 'edit' ? handleUpdate : handleCreate}
        serverTarget={target}
      />

      <DeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onConfirm={handleDelete}
        onCancel={() => setDialog(null)}
        title="Delete Schedule"
        description={DELETE_SCHEDULE_DESCRIPTION}
        isDeleting={deleteMutation.isPending}
      />

      <ScheduleRunRemovalDialog
        open={clearRunsOpen}
        onOpenChange={(open) => { if (!open) setClearRunsOpen(false) }}
        title="Clear run history"
        description={
          <>This permanently deletes all <strong>{clearableRuns.length}</strong> finished run{clearableRuns.length === 1 ? '' : 's'} for this schedule. A run in progress is kept. This cannot be undone.</>
        }
        affectedWorktreeCount={0}
        isPending={clearRunsMutation.isPending}
        onCancel={() => setClearRunsOpen(false)}
        onConfirm={() => {
          if (jobId === null) return
          clearRunsMutation.mutate(jobId, { onSuccess: () => setClearRunsOpen(false) })
        }}
      />

      <ScheduleRunRemovalDialog
        open={runToDelete !== null}
        onOpenChange={(open) => { if (!open) setRunToDelete(null) }}
        title="Delete run"
        description="This permanently deletes this run. This cannot be undone."
        affectedWorktreeCount={0}
        isPending={deleteRunMutation.isPending}
        onCancel={() => setRunToDelete(null)}
        onConfirm={() => {
          if (jobId === null || runToDelete === null) return
          deleteRunMutation.mutate({ jobId, runId: runToDelete }, { onSuccess: () => setRunToDelete(null) })
        }}
      />
    </>
  )
}
