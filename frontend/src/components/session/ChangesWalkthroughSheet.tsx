import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { SideDrawer, SideDrawerHeader } from '@/components/ui/side-drawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DiffLines } from '@/components/file-browser/DiffLines'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { useChangeWalkthrough, useGenerateChangeWalkthrough } from '@/hooks/useChangeWalkthrough'
import { GIT_STATUS_COLORS, GIT_STATUS_LABELS } from '@/lib/git-status-styles'
import { cn } from '@/lib/utils'
import { WalkthroughOmittedFileSchema } from '@opencode-manager/shared/schemas'
import type { WalkthroughHunk, WalkthroughOmittedFile } from '@opencode-manager/shared/schemas'

interface WalkthroughErrorLike {
  message?: string
  code?: string
  details?: unknown
}

function errorCode(error: unknown): string | undefined {
  return (error as WalkthroughErrorLike | null)?.code
}

function isNoChangesError(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'WALKTHROUGH_NO_CHANGES' || code === 'WALKTHROUGH_NO_TEXT_CHANGES'
}

function isContextLimitError(error: unknown): boolean {
  return errorCode(error) === 'WALKTHROUGH_CONTEXT_LIMIT'
}

function omittedFilesFromError(error: unknown): WalkthroughOmittedFile[] {
  const details = (error as { details?: { omittedFiles?: unknown } } | null)?.details
  const parsed = WalkthroughOmittedFileSchema.array().safeParse(details?.omittedFiles)
  return parsed.success ? parsed.data : []
}

function walkthroughErrorMessage(error: unknown): string {
  if (isNoChangesError(error)) {
    return 'This session has no text changes to walk through'
  }
  if (isContextLimitError(error)) {
    return 'These changes are too large to walk through'
  }
  return (error as WalkthroughErrorLike | null)?.message || 'Failed to load the walkthrough'
}

const OMITTED_REASON_LABELS: Record<WalkthroughOmittedFile['reason'], string> = {
  binary: 'binary file',
  budget: 'over the diff budget',
}

function OmittedFiles({ files }: { files: WalkthroughOmittedFile[] }) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">Omitted files</p>
      {files.map((omitted) => (
        <p key={omitted.file} className="break-all text-xs text-muted-foreground">
          {omitted.file} — {OMITTED_REASON_LABELS[omitted.reason]}
        </p>
      ))}
    </div>
  )
}

interface ChangesWalkthroughViewProps {
  sessionId: string
  active: boolean
}

/** Generates and steps through a session's change walkthrough; the caller supplies the surrounding chrome. */
export const ChangesWalkthroughView = memo(function ChangesWalkthroughView({ sessionId, active }: ChangesWalkthroughViewProps) {
  const stateQuery = useChangeWalkthrough(sessionId, active)
  const generate = useGenerateChangeWalkthrough(sessionId)
  const resetGenerate = generate.reset
  const [stopIndex, setStopIndex] = useState(0)
  const detailRef = useRef<HTMLDivElement>(null)

  const state = stateQuery.data
  const walkthrough = state?.walkthrough ?? null
  const stale = state?.stale ?? false
  const generating = generate.isPending || (state?.generating ?? false)
  const error = generate.error ?? stateQuery.error ?? (generating ? null : state?.error ?? null)
  const contextLimitFiles = isContextLimitError(error) ? omittedFilesFromError(error) : []

  useEffect(() => {
    resetGenerate()
  }, [active, sessionId, resetGenerate])

  useEffect(() => {
    setStopIndex(0)
  }, [active, sessionId, walkthrough?.createdAt])

  const hunksById = useMemo(
    () => new Map(walkthrough?.hunks.map((hunk) => [hunk.id, hunk]) ?? []),
    [walkthrough],
  )

  const stops = walkthrough?.stops ?? []
  const clampedIndex = stops.length > 0 ? Math.min(stopIndex, stops.length - 1) : 0
  const selectedStop = stops[clampedIndex] ?? null
  const selectedHunks = (selectedStop?.hunkIds ?? [])
    .map((id) => hunksById.get(id))
    .filter((hunk): hunk is WalkthroughHunk => hunk !== undefined)

  const selectStop = useCallback((index: number) => {
    setStopIndex(index)
    detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{walkthroughErrorMessage(error)}</p>
            {contextLimitFiles.length > 0 ? <OmittedFiles files={contextLimitFiles} /> : null}
          </div>
        ) : null}

        {generating ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>Generating walkthrough… this can take a minute or two.</span>
          </div>
        ) : null}

        {stateQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !walkthrough ? (
          generating ? null : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a step-by-step walkthrough of the changes in this session.
              </p>
              <Button onClick={() => generate.mutate({})}>Generate walkthrough</Button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            {stale && !generating ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="text-sm text-warning">
                  Changes have been updated since this walkthrough was generated
                </p>
                <Button variant="outline" size="sm" onClick={() => generate.mutate({ regenerate: true })}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>
            ) : null}

            <ScheduleRunMarkdown content={walkthrough.summary} />

            {stops.length > 0 ? (
              <ol className="space-y-0.5">
                {stops.map((stop, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => selectStop(index)}
                      aria-current={index === clampedIndex}
                      className={cn(
                        'w-full rounded-md px-2 py-1 text-left text-sm',
                        index === clampedIndex
                          ? 'bg-accent/40 font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-accent/20',
                      )}
                    >
                      {index + 1}. {stop.title}
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}

            {selectedStop ? (
              <div ref={detailRef} className="scroll-mt-4 space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">
                  {clampedIndex + 1}. {selectedStop.title}
                </h3>
                <ScheduleRunMarkdown content={selectedStop.explanation} />
                {selectedHunks.map((hunk) => (
                  <div key={hunk.id} className="overflow-hidden rounded-md border border-border">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={hunk.file}>
                        {hunk.file}
                      </span>
                      {hunk.truncated ? <Badge variant="outline">truncated</Badge> : null}
                      <span className={`text-xs ${GIT_STATUS_COLORS[hunk.status]}`}>
                        {GIT_STATUS_LABELS[hunk.status]}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <DiffLines diff={hunk.text} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {walkthrough.omittedFiles.length > 0 ? <OmittedFiles files={walkthrough.omittedFiles} /> : null}
          </div>
        )}
      </div>

      {stops.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background px-4 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <Button variant="outline" size="sm" onClick={() => selectStop(clampedIndex - 1)} disabled={clampedIndex === 0}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Stop {clampedIndex + 1} of {stops.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectStop(clampedIndex + 1)}
            disabled={clampedIndex >= stops.length - 1}
          >
            Next
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  )
})

interface ChangesWalkthroughSheetProps {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The walkthrough as a right-side sheet: full screen on mobile, a drawer over the page on desktop. */
export function ChangesWalkthroughSheet({ sessionId, open, onOpenChange }: ChangesWalkthroughSheetProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  return (
    <SideDrawer isOpen={open} onClose={close} side="right" widthClass="w-full sm:w-[min(640px,92vw)]" ariaLabel="Change walkthrough">
      <SideDrawerHeader title="Change walkthrough" onClose={close} />
      <ChangesWalkthroughView sessionId={sessionId} active={open} />
    </SideDrawer>
  )
}
