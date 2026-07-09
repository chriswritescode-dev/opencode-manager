import { useTranslation } from 'react-i18next'
import type { ScheduleJob } from '@opencode-manager/shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  formatScheduleSummary,
  formatTimestamp,
  getJobStatusTone,
  hasSkillMetadata,
} from '@/components/schedules/schedule-utils'
import { Bot, CalendarClock, Clock3, History, Loader2, Pencil, Play, Sparkles, Trash2 } from 'lucide-react'

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
  const { t } = useTranslation()

  if (!selectedJob) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <CalendarClock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-medium">{t('schedule.noJobSelected')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('schedule.selectJobForDetail')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <section className="overflow-hidden rounded-xl bg-card/40">
        <div className="border-b border-border/60 bg-card px-3 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold tracking-tight">{selectedJob.name}</h3>
                <Badge className={getJobStatusTone(selectedJob)}>{selectedJob.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{selectedJob.description || t('schedule.noDescription')}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatTimestamp(selectedJob.nextRunAt)}</span>
                <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" /> {t('schedule.lastRun')} {formatTimestamp(selectedJob.lastRunAt)}</span>
                <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {formatScheduleSummary(selectedJob)}</span>
                <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {selectedJob.agentSlug ?? t('schedule.defaultAgent')}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onToggleEnabled} disabled={updatePending}>
                {selectedJob.enabled ? t('schedule.pause') : t('common.enabled')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onEdit(selectedJob)} title={t('common.edit')}>
                <Pencil className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('common.edit')}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={onRunNow} disabled={runPending || runningRun || isJobFetching} title={runningRun ? t('schedule.runInProgress') : isJobFetching ? t('common.refreshing') : t('schedule.runNow')}>
                {runPending || isJobFetching ? <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" /> : <Play className="h-4 w-4 sm:mr-2" />}
                <span className="hidden sm:inline">{runningRun ? t('schedule.runInProgress') : isJobFetching ? t('common.refreshing') : t('schedule.runNow')}</span>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onDelete(selectedJob.id)} title={t('common.delete')}>
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('common.delete')}</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="p-3 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <section className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
                <div className="mb-3">
                  <h3 className="text-base font-medium">{t('settings.executionPrompt')}</h3>
                  <p className="text-sm text-muted-foreground">{t('schedule.promptSentToAgent')}</p>
                </div>
                <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{selectedJob.prompt}</pre>
              </section>

                {hasSkillMetadata(selectedJob) && (
                  <section className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
                  <div className="mb-3">
                    <h3 className="text-base font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" /> {t('schedule.advancedMetadata')}</h3>
                    <p className="text-sm text-muted-foreground">{t('schedule.advancedMetadataHint')}</p>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{JSON.stringify(selectedJob.skillMetadata, null, 2)}</pre>
                </section>
              )}
            </div>

            <Card className="border-border/60 bg-background/60 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">{t('settings.executionSettings')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('schedule.title')}</p>
                  <p className="font-medium break-words">{formatScheduleSummary(selectedJob)}</p>
                  {selectedJob.scheduleMode === 'cron' && selectedJob.cronExpression && (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selectedJob.cronExpression}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">{t('settings.agentName')}</p>
                  <p className="font-medium">{selectedJob.agentSlug ?? t('schedule.defaultAgent')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('model.selectModel')}</p>
                  <p className="font-medium break-all">{selectedJob.model ?? t('repo.workspaceDefault')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('common.created')}</p>
                  <p className="font-medium">{formatTimestamp(selectedJob.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('common.updated')}</p>
                  <p className="font-medium">{formatTimestamp(selectedJob.updatedAt)}</p>
                </div>
                {selectedJob.branch && (
                  <div>
                    <p className="text-muted-foreground">{t('schedule.baseBranch')}</p>
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
