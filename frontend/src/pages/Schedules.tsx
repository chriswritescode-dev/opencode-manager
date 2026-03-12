import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import {
  formatScheduleShortLabel,
  formatScheduleSummary,
  formatTimestamp,
  getJobStatusTone,
  getRunTone,
  hasSkillMetadata,
  toUpdateScheduleRequest,
} from '@/components/schedules/schedule-utils'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { getRepoDisplayName } from '@/lib/utils'
import {
  Bot,
  CalendarClock,
  ChevronDown,
  Clock3,
  History,
  Loader2,
  Play,
  Plus,
  Square,
  Sparkles,
  TerminalSquare,
  Trash2,
  Pencil,
} from 'lucide-react'

export function Schedules() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const repoId = id ? Number(id) : undefined
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScheduleJob | undefined>()
  const [deleteJobId, setDeleteJobId] = useState<number | null>(null)

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined,
  })
  const { data: jobs, isLoading: jobsLoading } = useRepoSchedules(repoId)
  const { data: selectedJob } = useRepoSchedule(repoId, selectedJobId)
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
      return
    }

    const stillExists = selectedJobId !== null && jobs.some((job) => job.id === selectedJobId)
    if (!stillExists) {
      setSelectedJobId(jobs[0]?.id ?? null)
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

  useEffect(() => {
    setDetailsExpanded(false)
  }, [selectedJobId])

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

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to={`/repos/${repoId}`} />
        <div className="min-w-0 flex-1 flex justify-center px-3">
          <Header.Title className="truncate">Schedules</Header.Title>
        </div>
        <Header.Actions>
          <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }} size="sm" className="hidden sm:flex">
            <Plus className="w-4 h-4 mr-2" />
            New Schedule
          </Button>
          <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }} size="sm" className="sm:hidden">
            <Plus className="w-4 h-4" />
          </Button>
        </Header.Actions>
      </Header>

      <div className="flex-1 min-h-0 overflow-hidden p-4 md:p-6">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{repoName}</p>
              <p className="text-xs text-muted-foreground">Recurring agent jobs and their run history.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="h-8 rounded-full px-3 text-xs">{jobs?.length ?? 0} jobs</Badge>
              <Badge variant="outline" className="h-8 rounded-full px-3 text-xs">{enabledCount} enabled</Badge>
            </div>
          </div>

          {!hasJobs ? (
            <div className="flex min-h-0 flex-1 items-start">
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
            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-rows-1 grid-rows-[minmax(0,240px)_minmax(0,1fr)]">
              <div className="min-h-0">
                <Card className="flex h-full min-h-0 flex-col border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Jobs</CardTitle>
                    <CardDescription>Pick a schedule to inspect, edit, or run.</CardDescription>
                  </CardHeader>
                  <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
                    {(jobs ?? []).map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${selectedJobId === job.id ? 'border-primary/30 bg-accent' : 'border-border/70 bg-background/60 hover:bg-accent/40'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{job.name}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{job.description || 'No description yet'}</p>
                          </div>
                          <Badge className={getJobStatusTone(job)}>{job.enabled ? 'Enabled' : 'Paused'}</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatScheduleShortLabel(job)}</span>
                          <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {job.agentSlug ?? 'default agent'}</span>
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="flex min-h-0 flex-col gap-4">
                {selectedJob ? (
                  <>
                    <section className="shrink-0 overflow-hidden rounded-xl border border-border/70 bg-card/40">
                      <div className="border-b border-border/60 bg-card px-6 py-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-xl font-semibold tracking-tight">{selectedJob.name}</h3>
                              <Badge className={getJobStatusTone(selectedJob)}>{selectedJob.enabled ? 'Enabled' : 'Paused'}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{selectedJob.description || 'No description provided.'}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatTimestamp(selectedJob.nextRunAt)}</span>
                              <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" /> Last run {formatTimestamp(selectedJob.lastRunAt)}</span>
                              <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {formatScheduleSummary(selectedJob)}</span>
                              <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {selectedJob.agentSlug ?? 'default agent'}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button variant="ghost" onClick={() => setDetailsExpanded((current) => !current)}>
                              <ChevronDown className={`mr-2 h-4 w-4 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`} />
                              {detailsExpanded ? 'Collapse details' : 'Expand details'}
                            </Button>
                            <Button variant="outline" onClick={handleToggleEnabled} disabled={updateMutation.isPending}>
                              {selectedJob.enabled ? 'Pause' : 'Enable'}
                            </Button>
                            <Button variant="outline" onClick={() => { setEditingJob(selectedJob); setDialogOpen(true) }}>
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </Button>
                            <Button variant="outline" onClick={handleRunNow} disabled={runMutation.isPending || Boolean(runningRun)}>
                              {runMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                              {runningRun ? 'Run in progress' : 'Run now'}
                            </Button>
                            <Button variant="destructive" onClick={() => setDeleteJobId(selectedJob.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </Button>
                          </div>
                        </div>
                      </div>

                      {detailsExpanded && (
                        <div className="max-h-[45vh] overflow-y-auto p-6">
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                            <div className="space-y-4">
                              <section className="rounded-lg border border-border/60 bg-background/40 p-4">
                                <div className="mb-3">
                                  <h3 className="text-base font-medium">Execution Prompt</h3>
                                  <p className="text-sm text-muted-foreground">Sent to OpenCode as the first message in the generated session.</p>
                                </div>
                                <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{selectedJob.prompt}</pre>
                              </section>

                              {hasSkillMetadata(selectedJob) && (
                                <section className="rounded-lg border border-border/60 bg-background/40 p-4">
                                  <div className="mb-3">
                                    <h3 className="text-base font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" /> Advanced metadata</h3>
                                    <p className="text-sm text-muted-foreground">Stored for future scheduler integrations. The current MVP does not execute against these fields yet.</p>
                                  </div>
                                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{JSON.stringify(selectedJob.skillMetadata, null, 2)}</pre>
                                </section>
                              )}
                            </div>

                            <Card className="border-border/60 bg-background/60 shadow-none">
                              <CardHeader>
                                <CardTitle className="text-base">Execution Settings</CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-3 text-sm">
                                <div>
                                  <p className="text-muted-foreground">Schedule</p>
                                  <p className="font-medium break-words">{formatScheduleSummary(selectedJob)}</p>
                                  {selectedJob.scheduleMode === 'cron' && selectedJob.cronExpression && (
                                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selectedJob.cronExpression}</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Agent</p>
                                  <p className="font-medium">{selectedJob.agentSlug ?? 'Default agent'}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Model</p>
                                  <p className="font-medium break-all">{selectedJob.model ?? 'Workspace default'}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Created</p>
                                  <p className="font-medium">{formatTimestamp(selectedJob.createdAt)}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Updated</p>
                                  <p className="font-medium">{formatTimestamp(selectedJob.updatedAt)}</p>
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        </div>
                      )}
                    </section>

                    <Card className="flex min-h-0 flex-1 flex-col border-border/70">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2"><TerminalSquare className="h-4 w-4" /> Run History</CardTitle>
                        <CardDescription>Inspect manual and scheduled executions, including assistant output and session handoff.</CardDescription>
                      </CardHeader>
                      <CardContent className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-rows-1 grid-rows-[minmax(0,220px)_minmax(0,1fr)]">
                        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                          {runsLoading ? (
                            <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                          ) : runs?.length ? runs.map((run) => (
                            <button
                              key={run.id}
                              type="button"
                              onClick={() => setSelectedRunId(run.id)}
                              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${selectedRunId === run.id ? 'border-primary/30 bg-accent' : 'border-border/70 bg-background/60 hover:bg-accent/40'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Badge className={getRunTone(run)}>{run.status}</Badge>
                                <span className="text-xs text-muted-foreground">{run.triggerSource}</span>
                              </div>
                              <p className="mt-3 text-sm font-medium">{new Date(run.startedAt).toLocaleString()}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{run.sessionTitle ?? run.errorText ?? 'No session metadata recorded'}</p>
                            </button>
                          )) : (
                            <Alert>
                              <History className="h-4 w-4" />
                              <AlertTitle>No runs yet</AlertTitle>
                              <AlertDescription>Use Run now to generate the first execution record and log bundle.</AlertDescription>
                            </Alert>
                          )}
                        </div>

                        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background/60 p-4">
                          {activeRun ? (
                            <Tabs key={`${activeRun.id}-${activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log'}`} defaultValue={activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log'} className="flex min-h-0 flex-1 flex-col">
                              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <Badge className={getRunTone(activeRun)}>{activeRun.status}</Badge>
                                    <span className="text-sm text-muted-foreground">{activeRun.triggerSource}</span>
                                  </div>
                                  <p className="mt-2 text-sm font-medium">Started {formatTimestamp(activeRun.startedAt)}</p>
                                  {activeRun.finishedAt && <p className="text-xs text-muted-foreground">Finished {formatTimestamp(activeRun.finishedAt)}</p>}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {activeRun.status === 'running' && (
                                    <Button variant="outline" size="sm" onClick={handleCancelRun} disabled={cancelRunMutation.isPending}>
                                      {cancelRunMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                                      Cancel run
                                    </Button>
                                  )}
                                  {activeRun.sessionId && (
                                    <Button variant="outline" size="sm" onClick={() => navigate(`/repos/${repoId}/sessions/${activeRun.sessionId}`)}>
                                      Open session
                                    </Button>
                                  )}
                                </div>
                              </div>

                              <TabsList>
                                <TabsTrigger value="log">Log</TabsTrigger>
                                <TabsTrigger value="response" disabled={!activeRun.responseText}>Assistant Output</TabsTrigger>
                                <TabsTrigger value="error" disabled={!activeRun.errorText}>{activeRun.status === 'cancelled' ? 'Details' : 'Error'}</TabsTrigger>
                              </TabsList>

                              <TabsContent value="log" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                {selectedRunLoading && !selectedRunDetails ? (
                                  <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                                ) : (
                                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.logText ?? 'No log text captured.'}</pre>
                                )}
                              </TabsContent>
                              <TabsContent value="response" className="mt-4 min-h-0 flex-1 overflow-hidden">
                                {selectedRunLoading && !selectedRunDetails ? (
                                  <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                                ) : activeRun.responseText ? (
                                  <Tabs defaultValue="preview" className="flex min-h-0 h-full flex-1 flex-col overflow-hidden">
                                    <TabsList>
                                      <TabsTrigger value="preview">Preview</TabsTrigger>
                                      <TabsTrigger value="markdown">Markdown</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="preview" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                      <ScheduleRunMarkdown content={activeRun.responseText} />
                                    </TabsContent>
                                    <TabsContent value="markdown" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                      <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.responseText}</pre>
                                    </TabsContent>
                                  </Tabs>
                                ) : (
                                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">No assistant output captured.</pre>
                                )}
                              </TabsContent>
                              <TabsContent value="error" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                {selectedRunLoading && !selectedRunDetails ? (
                                  <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                                ) : (
                                  <pre className={`whitespace-pre-wrap break-words text-sm font-mono leading-6 ${activeRun.status === 'cancelled' ? 'text-muted-foreground' : 'text-red-300'}`}>{activeRun.errorText ?? 'No error recorded.'}</pre>
                                )}
                              </TabsContent>
                            </Tabs>
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a run to inspect logs and output.</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card className="border-dashed border-border/70">
                    <CardContent className="p-10 text-center">
                      <CalendarClock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                      <p className="text-lg font-medium">No schedule selected</p>
                      <p className="mt-2 text-sm text-muted-foreground">Choose a job from the list or create a new one to configure agent automation for this repo.</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
