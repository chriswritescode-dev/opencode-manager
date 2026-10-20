import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SideDrawer, SideDrawerContent, SideDrawerHeader } from '@/components/ui/side-drawer'
import { RunDetailPanel } from './RunDetailPanel'
import { formatRunBranch, getRunRepoName, getRunStatusIcon, getRunStatusLabel, getRunTitle, type ScheduleRunRow } from './schedule-run-display'
import { formatRunDuration } from './schedule-utils'
import { useScheduleRunDetail } from '@/hooks/useSchedules'

interface ScheduleRunDrawerProps {
  run: ScheduleRunRow | null
  open: boolean
  onClose: () => void
  onCancelRun: () => void
  cancelPending: boolean
  runLoading?: boolean
  runError?: boolean
  onRetry?: () => void
  onNextUnread?: () => void
  nextUnreadCount?: number
  onPrev?: () => void
  onNext?: () => void
}

export function ScheduleRunDrawer({
  run,
  open,
  onClose,
  onCancelRun,
  cancelPending,
  runLoading = false,
  runError = false,
  onRetry,
  onNextUnread,
  nextUnreadCount = 0,
  onPrev,
  onNext,
}: ScheduleRunDrawerProps) {
  const { data: detail, isLoading } = useScheduleRunDetail(run)
  const activeRun = detail ?? run

  const title = run ? getRunTitle(run) : 'Run'
  const repoName = run ? getRunRepoName(run) : null
  const branch = activeRun ? formatRunBranch(activeRun) : null

  const meta = activeRun ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {getRunStatusIcon(activeRun.status)}
        <span>{getRunStatusLabel(activeRun.status)}</span>
      </span>
      {repoName && <span className="truncate">{repoName}</span>}
      <span title={new Date(activeRun.startedAt).toLocaleString()}>
        {activeRun.status === 'running' ? 'Running' : formatDistanceToNow(activeRun.startedAt, { addSuffix: true })}
      </span>
      <span className="tabular-nums">{formatRunDuration(activeRun)}</span>
      {branch && <span className="truncate font-mono">{branch}</span>}
    </div>
  ) : undefined

  const showNavigation = Boolean(onPrev || onNext)

  return (
    <SideDrawer isOpen={open} onClose={onClose} side="right" widthClass="w-full sm:w-[min(880px,92vw)]" ariaLabel={title}>
      <SideDrawerHeader
        title={title}
        onClose={onClose}
        meta={meta}
        actions={(
          <>
            {onNextUnread && nextUnreadCount > 0 && (
              <Button variant="outline" size="sm" className="h-8" onClick={onNextUnread}>
                Next unread ({nextUnreadCount})
              </Button>
            )}
            {showNavigation && (
              <>
                <Button variant="ghost" size="icon-sm" aria-label="Previous run" onClick={onPrev} disabled={!onPrev}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Next run" onClick={onNext} disabled={!onNext}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </>
        )}
      />
      <SideDrawerContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        {activeRun ? (
          <RunDetailPanel
            repoId={activeRun.repoId}
            serverId={activeRun.serverId}
            activeRun={activeRun}
            selectedRunLoading={isLoading && !detail}
            onCancelRun={onCancelRun}
            cancelRunPending={cancelPending}
          />
        ) : runLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : runError ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="space-y-3">
              <p className="text-lg font-semibold">Failed to load run</p>
              <p className="text-sm text-muted-foreground">The selected run could not be loaded.</p>
              {onRetry && (
                <Button variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="space-y-3">
              <p className="text-lg font-semibold">Run not found</p>
              <p className="text-sm text-muted-foreground">The requested run no longer exists.</p>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </SideDrawerContent>
    </SideDrawer>
  )
}
