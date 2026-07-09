import { useTranslation } from 'react-i18next'
import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { History, Loader2, Trash2 } from 'lucide-react'
import { RunHistoryCards, RunDetailPanel } from '@/components/schedules'

interface RunHistoryTabProps {
  repoId: number
  selectedJob: ScheduleJob | undefined
  runs: ScheduleRun[] | undefined
  runsLoading: boolean
  activeRun: ScheduleRun | null
  selectedRunLoading: boolean
  onSelectRun: (id: number) => void
  onCancelRun: () => void
  cancelRunPending: boolean
  onClearHistory: () => void
  clearHistoryPending: boolean
  onDeleteRun: (runId: number) => void
  deleteRunPending: boolean
}

export function RunHistoryTab({
  repoId,
  selectedJob,
  runs,
  runsLoading,
  onSelectRun,
  activeRun,
  selectedRunLoading,
  onCancelRun,
  cancelRunPending,
  onClearHistory,
  clearHistoryPending,
  onDeleteRun,
  deleteRunPending,
}: RunHistoryTabProps) {
  const { t } = useTranslation()

  if (!selectedJob) {
    if (selectedRunLoading) {
      return (
        <div className="flex min-h-0 flex-1 h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )
    }
    return (
      <div className="flex min-h-0 flex-1 h-full items-start">
        <Card className="max-w-3xl border-dashed border-border/70 w-full">
          <CardContent className="flex flex-col items-center p-8 sm:p-10 text-center">
            <History className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">{t('schedule.noJobSelected')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('schedule.selectJobForHistory')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 pt-2">
        <p className="text-sm font-medium text-muted-foreground">{t('schedule.runHistory')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onClearHistory}
          disabled={clearHistoryPending || !runs?.length}
        >
          {clearHistoryPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          {t('schedule.clearRunHistory')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pt-2 xl:gap-4 xl:grid xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-rows-1">
        <RunHistoryCards
          runs={runs}
          runsLoading={runsLoading}
          onSelectRun={onSelectRun}
          onCancelRun={onCancelRun}
          cancelRunPending={cancelRunPending}
          onDeleteRun={onDeleteRun}
          deleteRunPending={deleteRunPending}
        />

        <div className="hidden xl:flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background/60 p-4">
          <RunDetailPanel
            repoId={repoId}
            activeRun={activeRun}
            selectedRunLoading={selectedRunLoading}
            onCancelRun={onCancelRun}
            cancelRunPending={cancelRunPending}
          />
        </div>
      </div>
    </div>
  )
}
