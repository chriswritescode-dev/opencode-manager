import { useEffect, useMemo, useState } from 'react'
import type { CreateScheduleJobRequest, ScheduleJob, ScheduleRunWorktreesMode } from '@opencode-manager/shared/types'
import {
  useAllSchedules,
  useCancelRepoScheduleRun,
  useClearRepoScheduleRuns,
  useCreateRepoSchedule,
  useDeleteRepoSchedule,
  useDeleteRepoScheduleRun,
  useRepoSchedule,
  useRepoScheduleRuns,
  useRunRepoSchedule,
  useScheduleWorktrees,
  useUpdateRepoSchedule,
} from '@/hooks/useSchedules'
import { useScheduleUrlState } from '@/hooks/useScheduleUrlState'
import type { ScheduleJobWithRepo } from '@/api/schedules'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { cn } from '@/lib/utils'
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

interface RepoSchedulesContentProps {
  repoId: number
  embedded: boolean
}

/**
 * A repository's schedule jobs, job detail and run history with their dialogs.
 * `embedded` renders it inside a side panel, which has no page header to hold the New Schedule action.
 */
export function RepoSchedulesContent({ repoId, embedded }: RepoSchedulesContentProps) {
  const {
    scheduleTab,
    setScheduleTab,
    dialog,
    jobId,
    runId,
    openNewJob,
    openEditJob,
    openDeleteJob,
    closeDialog,
    selectRun,
    selectJobAndView,
    selectJobAndCloseDialog,
    replaceUrlParams,
  } = useScheduleUrlState()

  const repoScheduleTab = scheduleTab === 'prompts' ? 'jobs' : scheduleTab

  const { data: allSchedules, isLoading: jobsLoading } = useAllSchedules()
  const jobs = useMemo(
    () => allSchedules?.filter((job) => job.repoId === repoId),
    [allSchedules, repoId],
  )
  const { data: selectedJob, isFetching: isJobFetching } = useRepoSchedule(repoId, jobId)
  const { data: runs, isLoading: runsLoading } = useRepoScheduleRuns(repoId, jobId, 30)
  const { data: scheduleWorktrees = [] } = useScheduleWorktrees(repoId, jobId)

  const createMutation = useCreateRepoSchedule()
  const updateMutation = useUpdateRepoSchedule()
  const deleteMutation = useDeleteRepoSchedule()
  const runMutation = useRunRepoSchedule()
  const cancelRunMutation = useCancelRepoScheduleRun()
  const clearRunsMutation = useClearRepoScheduleRuns()
  const deleteRunMutation = useDeleteRepoScheduleRun()

  const [jobSearch, setJobSearch] = useState('')
  const [clearRunsOpen, setClearRunsOpen] = useState(false)
  const [runToDelete, setRunToDelete] = useState<number | null>(null)

  const clearableRuns = useMemo(() => (runs ?? []).filter((run) => run.status !== 'running'), [runs])
  const affectedClearWorktreeCount = useMemo(
    () => scheduleWorktrees.filter((worktree) => worktree.runId !== null && !worktree.inUse).length,
    [scheduleWorktrees],
  )
  const runToDeleteWorktreeCount = useMemo(
    () => (runToDelete !== null && scheduleWorktrees.some((worktree) => worktree.runId === runToDelete) ? 1 : 0),
    [scheduleWorktrees, runToDelete],
  )

  useEffect(() => {
    if (scheduleTab === 'prompts') {
      setScheduleTab('jobs')
    }
  }, [scheduleTab, setScheduleTab])

  const editingJob = useMemo<ScheduleJob | undefined>(
    () => (dialog === 'edit' && jobId !== null ? jobs?.find((j) => j.id === jobId) : undefined),
    [dialog, jobId, jobs],
  )

  useEffect(() => {
    if (jobs === undefined) return

    if (!jobs.length) {
      if (jobId !== null || scheduleTab !== 'jobs') {
        replaceUrlParams((p) => {
          p.delete('jobId')
          p.delete('scheduleTab')
        })
      }
      return
    }

    const stillExists = jobId !== null && jobs.some((job) => job.id === jobId)
    if (!stillExists) {
      const newId = jobs[0]?.id ?? null
      if (newId !== jobId || scheduleTab !== 'jobs') {
        replaceUrlParams((p) => {
          if (newId === null) p.delete('jobId')
          else p.set('jobId', String(newId))
          p.delete('scheduleTab')
        })
      }
    }
  }, [jobs, jobId, scheduleTab, replaceUrlParams])

  useEffect(() => {
    if (runs === undefined) return
    if (runId === null) return
    if (!runs.some((run) => run.id === runId)) selectRun(null)
  }, [runs, runId, selectRun])

  const runningRun = useMemo(() => runs?.find((run) => run.status === 'running') ?? null, [runs])

  if (jobsLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hasJobs = (jobs?.length ?? 0) > 0

  const handleCreate = (data: CreateScheduleJobRequest) => {
    createMutation.mutate({ repoId, data }, {
      onSuccess: (job) => {
        selectJobAndCloseDialog(job.id)
      },
    })
  }

  const handleUpdate = (data: CreateScheduleJobRequest) => {
    if (dialog !== 'edit' || jobId === null) {
      return
    }

    updateMutation.mutate({
      repoId,
      jobId,
      data: toUpdateScheduleRequest(data),
    }, {
      onSuccess: () => {
        closeDialog()
      },
    })
  }

  const handleDelete = () => {
    if (dialog !== 'delete' || jobId === null) {
      return
    }

    deleteMutation.mutate({ repoId, jobId }, {
      onSuccess: () => {
        closeDialog()
      },
    })
  }

  const handleToggleEnabled = (job: ScheduleJob) => {
    updateMutation.mutate({
      repoId,
      jobId: job.id,
      data: { enabled: !job.enabled },
    })
  }

  const handleRunNow = (job: ScheduleJob) => {
    runMutation.mutate({ repoId, jobId: job.id }, {
      onSuccess: (run) => {
        selectRun(run.id)
      },
    })
  }

  const handleCancelRun = () => {
    const target = runId !== null ? runs?.find((run) => run.id === runId) ?? null : null
    if (!target || target.status !== 'running') {
      return
    }

    cancelRunMutation.mutate({
      repoId,
      jobId: target.jobId,
      runId: target.id,
    }, {
      onSuccess: (run) => {
        selectRun(run.id)
      },
    })
  }

  const handleCancelJobRun = (job: ScheduleJobWithRepo) => {
    if (!job.lastRun) {
      return
    }

    cancelRunMutation.mutate({
      repoId,
      jobId: job.id,
      runId: job.lastRun.id,
    })
  }

  const handleClearHistory = (worktrees?: ScheduleRunWorktreesMode) => {
    if (jobId === null) {
      return
    }

    clearRunsMutation.mutate({ repoId, jobId, worktrees }, {
      onSuccess: () => setClearRunsOpen(false),
    })
  }

  const handleConfirmDeleteRun = (worktrees?: ScheduleRunWorktreesMode) => {
    if (jobId === null || runToDelete === null) {
      return
    }

    deleteRunMutation.mutate({ repoId, jobId, runId: runToDelete, worktrees }, {
      onSuccess: () => setRunToDelete(null),
    })
  }

  return (
    <>
      <div className={cn('flex flex-1 min-h-0 flex-col overflow-hidden', embedded ? 'px-3' : 'px-2 md:px-6')}>
        {!hasJobs ? (
          <div className={cn('flex min-h-0 flex-1 h-full items-start', embedded && 'pt-3')}>
            <Card className="max-w-3xl border-dashed border-border/70">
              <CardContent className={cn('flex flex-col items-start gap-4', embedded ? 'p-6' : 'p-8 sm:p-10')}>
                <div className="rounded-full border border-border bg-muted/40 p-3">
                  <CalendarClock className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  <p className="text-xl font-semibold tracking-tight">No schedules yet</p>
                  <p className="text-sm text-muted-foreground">Create a schedule for this repo to automate recurring agent work, then inspect runs, logs, and sessions here.</p>
                </div>
                <Button onClick={openNewJob}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Schedule
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {repoScheduleTab === 'jobs' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ScheduleListToolbar search={jobSearch} onSearchChange={setJobSearch} searchPlaceholder="Search jobs">
                  {embedded ? (
                    <Button onClick={openNewJob} size="sm" className="h-9 shrink-0">
                      <Plus className="w-4 h-4 mr-1" />
                      New Schedule
                    </Button>
                  ) : null}
                </ScheduleListToolbar>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2 pb-mobile-tabbar sm:pb-2">
                <div className="min-h-0 overflow-auto rounded-lg border border-border/70">
                  <ScheduleJobsTable
                    jobs={(jobs ?? []).filter((job) => matchesScheduleJobSearch(job, jobSearch))}
                    showRepo={false}
                    selectedJobId={jobId}
                    onOpen={(job) => selectJobAndView(job.id)}
                    onRunNow={handleRunNow}
                    onToggleEnabled={handleToggleEnabled}
                    onEdit={(job) => openEditJob(job.id)}
                    onDelete={(job) => openDeleteJob(job.id)}
                    onCancelRun={handleCancelJobRun}
                    runPending={runMutation.isPending}
                    cancelPending={cancelRunMutation.isPending}
                  />
                </div>
                </div>
              </div>
            )}
            {repoScheduleTab === 'detail' && (
              <JobDetailTab
                selectedJob={selectedJob}
                onEdit={(job) => openEditJob(job.id)}
                onDelete={openDeleteJob}
                onToggleEnabled={() => { if (selectedJob) handleToggleEnabled(selectedJob) }}
                onRunNow={() => { if (selectedJob) handleRunNow(selectedJob) }}
                updatePending={updateMutation.isPending}
                runPending={runMutation.isPending}
                runningRun={Boolean(runningRun)}
                isJobFetching={isJobFetching}
              />
            )}
            {repoScheduleTab === 'runs' && (
              <RunHistoryTab
                selectedJob={selectedJob}
                runs={runs}
                runsLoading={runsLoading}
                runId={runId}
                onSelectRun={selectRun}
                onCancelRun={handleCancelRun}
                cancelRunPending={cancelRunMutation.isPending}
                onClearHistory={() => setClearRunsOpen(true)}
                clearHistoryPending={clearRunsMutation.isPending}
                onDeleteRun={(id) => setRunToDelete(id)}
                deleteRunPending={deleteRunMutation.isPending}
              />
            )}
          </>
        )}
      </div>

      {hasJobs && (
        <div className={embedded ? undefined : 'sm:block hidden'}>
          <ScheduleTabMenu
            activeTab={repoScheduleTab as 'jobs' | 'detail' | 'runs'}
            onTabChange={(tab) => setScheduleTab(tab)}
          />
        </div>
      )}

      <ScheduleJobDialog
        open={dialog === 'new' || dialog === 'edit'}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
        job={editingJob}
        repoId={repoId}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSubmit={dialog === 'edit' ? handleUpdate : handleCreate}
      />

      <DeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && closeDialog()}
        onConfirm={handleDelete}
        onCancel={() => closeDialog()}
        title="Delete Schedule"
        description={DELETE_SCHEDULE_DESCRIPTION}
        isDeleting={deleteMutation.isPending}
      />

      <ScheduleRunRemovalDialog
        open={clearRunsOpen}
        onOpenChange={(open) => !open && setClearRunsOpen(false)}
        title="Clear run history"
        description={
          <>This permanently deletes all <strong>{clearableRuns.length}</strong> finished run{clearableRuns.length === 1 ? '' : 's'} for this schedule. A run in progress is kept. This cannot be undone.</>
        }
        affectedWorktreeCount={affectedClearWorktreeCount}
        isPending={clearRunsMutation.isPending}
        onCancel={() => setClearRunsOpen(false)}
        onConfirm={handleClearHistory}
      />

      <ScheduleRunRemovalDialog
        open={runToDelete !== null}
        onOpenChange={(open) => !open && setRunToDelete(null)}
        title="Delete run"
        description="This permanently deletes this run. This cannot be undone."
        affectedWorktreeCount={runToDeleteWorktreeCount}
        isPending={deleteRunMutation.isPending}
        onCancel={() => setRunToDelete(null)}
        onConfirm={handleConfirmDeleteRun}
      />
    </>
  )
}
