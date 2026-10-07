import type { ScheduleJob } from '@opencode-manager/shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  formatScheduleSummary,
  formatTimestamp,
  getJobStatusTone,
  formatWorkspaceMode,
  hasSkillMetadata,
} from '@/components/schedules/schedule-utils'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { useRemoveScheduleWorktrees, useScheduleWorktrees } from '@/hooks/useSchedules'
import { formatScheduleWorktreeLabel } from '@/lib/schedules/schedule-worktree'
import { Bot, CalendarClock, Clock3, GitBranch, History, Loader2, Pencil, Play, Sparkles, Trash2 } from 'lucide-react'
import { useScheduleModels } from '@/hooks/useScheduleModels'
import { useScheduleTarget } from '@/hooks/useScheduleTarget'
import { resolveScheduleModel } from '@/lib/schedules/schedule-model'

interface JobDetailTabProps {
  selectedJob: ScheduleJob | undefined
  onEdit: (job: ScheduleJob) => void
  onDelete: (jobId: number) => void
  onToggleEnabled: () => void
  onRunNow: () => void
  updatePending: boolean
  runPending: boolean
  runningRun: boolean
  isJobFetching: boolean
}

export function JobDetailTab({
  selectedJob,
  onEdit,
  onDelete,
  onToggleEnabled,
  onRunNow,
  updatePending,
  runPending,
  runningRun,
  isJobFetching,
}: JobDetailTabProps) {
  const { scheduleTarget } = useScheduleTarget(selectedJob?.repoId)
  const { availableModels } = useScheduleModels(Boolean(selectedJob), scheduleTarget?.fullPath)
  const resolvedModel = resolveScheduleModel(selectedJob?.model, availableModels)
  const { data: worktrees = [] } = useScheduleWorktrees(selectedJob?.repoId, selectedJob?.id ?? null)
  const removeWorktrees = useRemoveScheduleWorktrees()
  const idleWorktreeCount = worktrees.filter((worktree) => !worktree.inUse).length

  if (!selectedJob) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <CalendarClock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-medium">No job selected</p>
          <p className="mt-2 text-sm text-muted-foreground">Select a job from the Jobs tab to view details</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pb-mobile-tabbar sm:pb-0">
      <section className="overflow-hidden rounded-xl bg-card/40">
        <div className="border-b border-border/60 bg-card px-3 py-4 sm:px-6 sm:py-5">
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
              <Button variant="outline" size="sm" onClick={onToggleEnabled} disabled={updatePending}>
                {selectedJob.enabled ? 'Pause' : 'Enable'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onEdit(selectedJob)} title="Edit">
                <Pencil className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <Button variant="outline" size="sm" onClick={onRunNow} disabled={runPending || runningRun || isJobFetching} title={runningRun ? 'Run in progress' : isJobFetching ? 'Refreshing...' : 'Run now'}>
                {runPending || isJobFetching ? <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" /> : <Play className="h-4 w-4 sm:mr-2" />}
                <span className="hidden sm:inline">{runningRun ? 'Run in progress' : isJobFetching ? 'Refreshing...' : 'Run now'}</span>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onDelete(selectedJob.id)} title="Delete">
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="p-3 sm:p-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <section className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
                <div className="mb-3">
                  <h3 className="text-base font-medium">Execution Prompt</h3>
                  <p className="text-sm text-muted-foreground">Sent to OpenCode as the first message in the generated session.</p>
                </div>
                <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{selectedJob.prompt}</pre>
              </section>

                {hasSkillMetadata(selectedJob) && (
                  <section className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
                  <div className="mb-3">
                    <h3 className="text-base font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" /> Advanced metadata</h3>
                    <p className="text-sm text-muted-foreground">Stored for future scheduler integrations. The current MVP does not execute against these fields yet.</p>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{JSON.stringify(selectedJob.skillMetadata, null, 2)}</pre>
                </section>
              )}

              {worktrees.length > 0 && (
                <section className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-medium flex items-center gap-2"><GitBranch className="h-4 w-4" /> Worktrees ({worktrees.length})</h3>
                      <p className="text-sm text-muted-foreground">Worktrees this schedule has on disk. Removing one commits any pending changes to its branch first and keeps the branch.</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Remove all worktrees"
                      onClick={() => removeWorktrees.mutate({ repoId: selectedJob.repoId, jobId: selectedJob.id })}
                      disabled={removeWorktrees.isPending || idleWorktreeCount === 0}
                    >
                      {removeWorktrees.isPending ? <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 sm:mr-2" />}
                      <span className="hidden sm:inline">Remove all</span>
                    </Button>
                  </div>
                  <ul className="divide-y divide-border/60">
                    {worktrees.map((worktree) => (
                      <li key={worktree.worktreePath} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm">{worktree.branch}</p>
                          <p className="truncate text-xs text-muted-foreground" title={worktree.worktreePath}>
                            {formatScheduleWorktreeLabel(worktree.runId)}
                            {worktree.inUse ? ' · in use' : ''} · {worktree.worktreePath}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove worktree ${worktree.branch}`}
                          title={worktree.inUse ? 'In use by a running run' : 'Remove worktree'}
                          onClick={() => removeWorktrees.mutate({ repoId: selectedJob.repoId, jobId: selectedJob.id, worktreePath: worktree.worktreePath })}
                          disabled={worktree.inUse || removeWorktrees.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
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
                  <p className="font-medium break-all">{resolvedModel ?? 'Workspace default'}</p>
                </div>
                {selectedJob.repoId !== ASSISTANT_REPO_ID && (
                  <div>
                    <p className="text-muted-foreground">Workspace</p>
                    <p className="font-medium">{formatWorkspaceMode(selectedJob.workspaceMode)}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">{formatTimestamp(selectedJob.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Updated</p>
                  <p className="font-medium">{formatTimestamp(selectedJob.updatedAt)}</p>
                </div>
                {selectedJob.branch && (
                  <div>
                    <p className="text-muted-foreground">Base branch</p>
                    <p className="font-medium font-mono">{selectedJob.branch}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  )
}
