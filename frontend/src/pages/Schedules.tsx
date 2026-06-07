import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import type { CreateScheduleJobRequest, ScheduleJob } from '@opencode-manager/shared/types'
import {
  useCancelRepoScheduleRun,
  useCreateRepoSchedule,
  useDeleteRepoSchedule,
  useRepoSchedule,
  useRepoScheduleRun,
  useRepoScheduleRuns,
  useRepoSchedules,
  useRunRepoSchedule,
  useUpdateRepoSchedule,
} from '@/hooks/useSchedules'
import { useRepoActivity } from '@/hooks/useRepoActivity'
import { useScheduleTarget } from '@/hooks/useScheduleTarget'
import { useScheduleUrlState } from '@/hooks/useScheduleUrlState'
import { ScheduleJobDialog, JobsTab, JobDetailTab, RunHistoryTab, ScheduleTabMenu } from '@/components/schedules'
import { toUpdateScheduleRequest } from '@/components/schedules/schedule-utils'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { CalendarClock, Loader2, Plus } from 'lucide-react'

export function Schedules() {
  const { id } = useParams<{ id: string }>()
  const repoId = id ? Number(id) : undefined

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

  const { scheduleTarget, isLoading: scheduleTargetLoading } = useScheduleTarget(repoId)

  useRepoActivity(repoId ?? 0, Boolean(scheduleTarget) && scheduleTarget?.kind === 'repo')

  const { data: jobs, isLoading: jobsLoading } = useRepoSchedules(repoId)
  const { data: selectedJob, isFetching: isJobFetching } = useRepoSchedule(repoId, jobId)
  const { data: runs, isLoading: runsLoading } = useRepoScheduleRuns(repoId, jobId, 30)
  const { data: selectedRunDetails, isLoading: selectedRunLoading } = useRepoScheduleRun(repoId, jobId, runId)

  const createMutation = useCreateRepoSchedule()
  const updateMutation = useUpdateRepoSchedule()
  const deleteMutation = useDeleteRepoSchedule()
  const runMutation = useRunRepoSchedule()
  const cancelRunMutation = useCancelRepoScheduleRun()

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

    if (!runs.length) {
      if (runId !== null) selectRun(null)
      return
    }

    const stillExists = runId !== null && runs.some((run) => run.id === runId)
    if (!stillExists) {
      const newRunId = runs[0]?.id ?? null
      if (newRunId !== runId) selectRun(newRunId)
    }
  }, [runs, runId, selectRun])

  const activeRunSummary = useMemo(() => runs?.find((run) => run.id === runId) ?? null, [runs, runId])
  const activeRun = selectedRunDetails ?? activeRunSummary
  const runningRun = useMemo(() => runs?.find((run) => run.status === 'running') ?? null, [runs])

  if (scheduleTargetLoading || jobsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!scheduleTarget || repoId === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">
          {repoId === 0 ? 'Assistant not found' : 'Repository not found'}
        </p>
      </div>
    )
  }
  const hasJobs = (jobs?.length ?? 0) > 0

  const handleCreate = (data: CreateScheduleJobRequest) => {
    createMutation.mutate({ repoId: repoId!, data }, {
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
      repoId: repoId!,
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

    const deletedJobId = jobId
    deleteMutation.mutate({ repoId: repoId!, jobId: deletedJobId }, {
      onSuccess: () => {
        closeDialog()
      },
    })
  }

  const handleToggleEnabled = () => {
    if (!selectedJob) {
      return
    }

    updateMutation.mutate({
      repoId: repoId!,
      jobId: selectedJob.id,
      data: { enabled: !selectedJob.enabled },
    })
  }

  const handleRunNow = () => {
    if (!selectedJob) {
      return
    }

    runMutation.mutate({ repoId: repoId!, jobId: selectedJob.id }, {
      onSuccess: (run) => {
        selectRun(run.id)
      },
    })
  }

  const handleCancelRun = () => {
    if (!activeRun || activeRun.status !== 'running') {
      return
    }

    cancelRunMutation.mutate({
      repoId: repoId!,
      jobId: activeRun.jobId,
      runId: activeRun.id,
    }, {
      onSuccess: (run) => {
        selectRun(run.id)
      },
    })
  }

  const handleSelectJob = (id: number) => {
    selectJobAndView(id)
  }

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0">
      <Header>
        <Header.BackButton to={scheduleTarget.backHref} />
        <div className="min-w-0 flex-1 px-3">
          <Header.Title className="truncate">{scheduleTarget.name}</Header.Title>
          <p className="text-xs text-muted-foreground truncate">{scheduleTarget.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Header.Actions>
            <Button onClick={openNewJob} size="sm" className="hidden sm:flex">
              <Plus className="w-4 h-4 mr-2" />
              New Schedule
            </Button>
            <Button onClick={openNewJob} size="sm" className="sm:hidden h-10 w-10 p-0">
              <Plus className="w-5 h-5" />
            </Button>
          </Header.Actions>
        </div>
      </Header>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-2 md:px-6">
        {!hasJobs ? (
          <div className="flex min-h-0 flex-1 h-full items-start">
            <Card className="max-w-3xl border-dashed border-border/70">
              <CardContent className="flex flex-col items-start gap-4 p-8 sm:p-10">
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
              <JobsTab
                jobs={jobs ?? []}
                selectedJobId={jobId}
                onSelectJob={handleSelectJob}
              />
            )}
            {repoScheduleTab === 'detail' && (
              <JobDetailTab
                selectedJob={selectedJob}
                onEdit={(job) => openEditJob(job.id)}
                onDelete={openDeleteJob}
                onToggleEnabled={handleToggleEnabled}
                onRunNow={handleRunNow}
                updatePending={updateMutation.isPending}
                runPending={runMutation.isPending}
                runningRun={Boolean(runningRun)}
                isJobFetching={isJobFetching}
              />
            )}
            {repoScheduleTab === 'runs' && (
              <RunHistoryTab
                repoId={repoId}
                selectedJob={selectedJob}
                runs={runs}
                runsLoading={runsLoading}
                onSelectRun={selectRun}
                activeRun={activeRun}
                selectedRunLoading={selectedRunLoading}
                onCancelRun={handleCancelRun}
                cancelRunPending={cancelRunMutation.isPending}
              />
            )}
          </>
        )}
      </div>

      {hasJobs && (
        <div className="sm:block hidden">
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
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSubmit={dialog === 'edit' ? handleUpdate : handleCreate}
      />

      <DeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && closeDialog()}
        onConfirm={handleDelete}
        onCancel={() => closeDialog()}
        title="Delete Schedule"
        description="This removes the job definition and all recorded run history for it."
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
