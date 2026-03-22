import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, ScheduleJob } from '@opencode-manager/shared/types'
import { getRepo } from '@/api/repos'
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
import { ScheduleJobDialog } from '@/components/schedules/ScheduleJobDialog'
import { JobsTab, JobDetailTab, RunHistoryTab } from '@/components/schedules'
import { toUpdateScheduleRequest, getJobStatusTone } from '@/components/schedules/schedule-utils'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { getRepoDisplayName, cn } from '@/lib/utils'
import { CalendarClock, History, Info, Loader2, Plus } from 'lucide-react'

export function Schedules() {
  const { id } = useParams<{ id: string }>()
  const repoId = id ? Number(id) : undefined
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScheduleJob | undefined>()
  const [deleteJobId, setDeleteJobId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'jobs' | 'detail' | 'runs'>('jobs')

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined,
  })
  const { data: jobs, isLoading: jobsLoading } = useRepoSchedules(repoId)
  const { data: selectedJob, isFetching: isJobFetching } = useRepoSchedule(repoId, selectedJobId)
  const { data: runs, isLoading: runsLoading } = useRepoScheduleRuns(repoId, selectedJobId, 30)
  const { data: selectedRunDetails, isLoading: selectedRunLoading } = useRepoScheduleRun(repoId, selectedJobId, selectedRunId)

  const createMutation = useCreateRepoSchedule(repoId)
  const updateMutation = useUpdateRepoSchedule(repoId)
  const deleteMutation = useDeleteRepoSchedule(repoId)
  const runMutation = useRunRepoSchedule(repoId)
  const cancelRunMutation = useCancelRepoScheduleRun(repoId)

  useEffect(() => {
    if (!jobs?.length) {
      setSelectedJobId(null)
      setActiveTab('jobs')
      return
    }

    const stillExists = selectedJobId !== null && jobs.some((job) => job.id === selectedJobId)
    if (!stillExists) {
      setSelectedJobId(jobs[0]?.id ?? null)
      setActiveTab('jobs')
    }
  }, [jobs, selectedJobId])

  useEffect(() => {
    if (!runs?.length) {
      setSelectedRunId(null)
      return
    }

    const stillExists = selectedRunId !== null && runs.some((run) => run.id === selectedRunId)
    if (!stillExists) {
      setSelectedRunId(runs[0]?.id ?? null)
    }
  }, [runs, selectedRunId])



  const activeRunSummary = useMemo(() => runs?.find((run) => run.id === selectedRunId) ?? null, [runs, selectedRunId])
  const activeRun = selectedRunDetails ?? activeRunSummary
  const runningRun = useMemo(() => runs?.find((run) => run.status === 'running') ?? null, [runs])

  if (repoLoading || jobsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!repo || repoId === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">Repository not found</p>
      </div>
    )
  }

  const repoName = getRepoDisplayName(repo.repoUrl, repo.localPath)
  const enabledCount = jobs?.filter((job) => job.enabled).length ?? 0
  const hasJobs = (jobs?.length ?? 0) > 0

  const handleCreate = (data: CreateScheduleJobRequest) => {
    createMutation.mutate(data, {
      onSuccess: (job) => {
        setSelectedJobId(job.id)
        setDialogOpen(false)
        setEditingJob(undefined)
      },
    })
  }

  const handleUpdate = (data: CreateScheduleJobRequest) => {
    if (!editingJob) {
      return
    }

    updateMutation.mutate({
      jobId: editingJob.id,
      data: toUpdateScheduleRequest(data),
    }, {
      onSuccess: () => {
        setDialogOpen(false)
        setEditingJob(undefined)
      },
    })
  }

  const handleDelete = () => {
    if (deleteJobId === null) {
      return
    }

    deleteMutation.mutate(deleteJobId, {
      onSuccess: () => {
        if (selectedJobId === deleteJobId) {
          setSelectedJobId(null)
        }
        setDeleteJobId(null)
      },
    })
  }

  const handleToggleEnabled = () => {
    if (!selectedJob) {
      return
    }

    updateMutation.mutate({
      jobId: selectedJob.id,
      data: { enabled: !selectedJob.enabled },
    })
  }

  const handleRunNow = () => {
    if (!selectedJob) {
      return
    }

    runMutation.mutate(selectedJob.id, {
      onSuccess: (run) => {
        setSelectedRunId(run.id)
      },
    })
  }

  const handleCancelRun = () => {
    if (!activeRun || activeRun.status !== 'running') {
      return
    }

    cancelRunMutation.mutate({
      jobId: activeRun.jobId,
      runId: activeRun.id,
    }, {
      onSuccess: (run) => {
        setSelectedRunId(run.id)
      },
    })
  }

  const handleSelectJob = (jobId: number) => {
    setSelectedJobId(jobId)
    setActiveTab('detail')
  }

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to={`/repos/${repoId}`} />
        <div className="min-w-0 flex-1 px-3">
          <Header.Title className="truncate">Schedules</Header.Title>
          <p className="text-xs text-muted-foreground truncate">{repoName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-6 rounded-full px-2 text-xs">{jobs?.length ?? 0} jobs</Badge>
          <Badge variant="outline" className={cn('h-6 rounded-full px-2 text-xs', getJobStatusTone({ enabled: true } as ScheduleJob))}>{enabledCount} enabled</Badge>
          <Header.Actions>
            <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }} size="sm" className="hidden sm:flex">
              <Plus className="w-4 h-4 mr-2" />
              New Schedule
            </Button>
            <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }} size="sm" className="sm:hidden">
              <Plus className="w-4 h-4" />
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
                <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Schedule
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {activeTab === 'jobs' && (
              <JobsTab
                jobs={jobs ?? []}
                selectedJobId={selectedJobId}
                onSelectJob={handleSelectJob}
              />
            )}
            {activeTab === 'detail' && (
              <JobDetailTab
                selectedJob={selectedJob}
                onEdit={(job) => { setEditingJob(job); setDialogOpen(true) }}
                onDelete={setDeleteJobId}
                onToggleEnabled={handleToggleEnabled}
                onRunNow={handleRunNow}
                updatePending={updateMutation.isPending}
                runPending={runMutation.isPending}
                runningRun={Boolean(runningRun)}
                isJobFetching={isJobFetching}
              />
            )}
            {activeTab === 'runs' && (
              <RunHistoryTab
                repoId={repoId}
                selectedJob={selectedJob}
                runs={runs}
                runsLoading={runsLoading}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
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
        <div className="flex border-t border-border bg-card/80 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
          <button
            type="button"
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors',
              activeTab === 'jobs'
                ? 'bg-primary/10 text-primary'
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
            onClick={() => setActiveTab('jobs')}
          >
            <CalendarClock className="h-5 w-5" />
            <span>Jobs</span>
          </button>
          <button
            type="button"
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors',
              activeTab === 'detail'
                ? 'bg-primary/10 text-primary'
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
            onClick={() => setActiveTab('detail')}
          >
            <Info className="h-5 w-5" />
            <span>Detail</span>
          </button>
          <button
            type="button"
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors',
              activeTab === 'runs'
                ? 'bg-primary/10 text-primary'
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
            onClick={() => setActiveTab('runs')}
          >
            <History className="h-5 w-5" />
            <span>Run History</span>
          </button>
        </div>
      )}

      <ScheduleJobDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditingJob(undefined)
          }
        }}
        job={editingJob}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSubmit={editingJob ? handleUpdate : handleCreate}
      />

      <DeleteDialog
        open={deleteJobId !== null}
        onOpenChange={(open) => !open && setDeleteJobId(null)}
        onConfirm={handleDelete}
        onCancel={() => setDeleteJobId(null)}
        title="Delete Schedule"
        description="This removes the job definition and all recorded run history for it."
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
