import { memo, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DiffLines } from '@/components/file-browser/DiffLines'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { useChangeWalkthrough, useGenerateChangeWalkthrough } from '@/hooks/useChangeWalkthrough'
import { GIT_STATUS_COLORS, GIT_STATUS_LABELS } from '@/lib/git-status-styles'
import { WalkthroughOmittedFileSchema } from '@opencode-manager/shared/schemas'
import type { WalkthroughHunk, WalkthroughOmittedFile } from '@opencode-manager/shared/schemas'

interface ChangesWalkthroughDialogProps {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function isNoChangesError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'WALKTHROUGH_NO_CHANGES' || code === 'WALKTHROUGH_NO_TEXT_CHANGES'
}

function isContextLimitError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'WALKTHROUGH_CONTEXT_LIMIT'
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
  return error instanceof Error ? error.message : 'Failed to load the walkthrough'
}

const OMITTED_REASON_LABELS: Record<WalkthroughOmittedFile['reason'], string> = {
  binary: 'binary file',
  budget: 'over the diff budget',
}

export const ChangesWalkthroughDialog = memo(function ChangesWalkthroughDialog({ sessionId, open, onOpenChange }: ChangesWalkthroughDialogProps) {
  const stateQuery = useChangeWalkthrough(sessionId, open)
  const generate = useGenerateChangeWalkthrough(sessionId)
  const [stopIndex, setStopIndex] = useState(0)

  const walkthrough = stateQuery.data?.walkthrough ?? null
  const stale = stateQuery.data?.stale ?? false
  const error = generate.error ?? stateQuery.error
  const contextLimitFiles = isContextLimitError(error) ? omittedFilesFromError(error) : []

  useEffect(() => {
    generate.reset()
  }, [open, sessionId, generate.reset])

  useEffect(() => {
    setStopIndex(0)
  }, [open, sessionId, walkthrough?.createdAt])

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        mobileFullscreen
        keyboardAware
        className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe"
      >
        <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
          <DialogTitle>Change walkthrough</DialogTitle>
          <DialogDescription>Walk through this session's changes, explained step by step.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {error ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{walkthroughErrorMessage(error)}</p>
              {contextLimitFiles.length > 0 ? (
                <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Omitted files</p>
                  {contextLimitFiles.map((omitted) => (
                    <p key={omitted.file} className="text-xs text-muted-foreground">
                      {omitted.file} — {OMITTED_REASON_LABELS[omitted.reason]}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {stateQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !walkthrough ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a step-by-step walkthrough of the changes in this session.
              </p>
              <Button
                onClick={() => generate.mutate({})}
                disabled={generate.isPending}
              >
                {generate.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating walkthrough…
                  </>
                ) : (
                  'Generate walkthrough'
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {stale ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                  <p className="text-sm text-warning">
                    Changes have been updated since this walkthrough was generated
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generate.mutate({ regenerate: true })}
                    disabled={generate.isPending}
                  >
                    {generate.isPending ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    )}
                    Regenerate
                  </Button>
                </div>
              ) : null}

              <ScheduleRunMarkdown content={walkthrough.summary} />

              {stops.length > 0 ? (
                <div className="space-y-3">
                  <ol className="space-y-1">
                    {stops.map((stop, index) => (
                      <li key={index}>
                        <button
                          type="button"
                          onClick={() => setStopIndex(index)}
                          aria-current={index === clampedIndex}
                          className={
                            index === clampedIndex
                              ? 'w-full rounded-md bg-accent/40 px-2 py-1 text-left text-sm font-medium text-foreground'
                              : 'w-full rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/20'
                          }
                        >
                          {index + 1}. {stop.title}
                        </button>
                      </li>
                    ))}
                  </ol>

                  <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStopIndex(clampedIndex - 1)}
                      disabled={clampedIndex === 0}
                    >
                      <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Stop {clampedIndex + 1} of {stops.length}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStopIndex(clampedIndex + 1)}
                      disabled={clampedIndex >= stops.length - 1}
                    >
                      Next
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {selectedStop ? (
                    <div className="space-y-3">
                      <ScheduleRunMarkdown content={selectedStop.explanation} />
                      {selectedHunks.map((hunk) => (
                        <div key={hunk.id} className="overflow-hidden rounded-md border border-border">
                          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                              {hunk.file}
                            </span>
                            {hunk.truncated ? (
                              <Badge variant="outline">truncated</Badge>
                            ) : null}
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
                </div>
              ) : null}

              {walkthrough.omittedFiles.length > 0 ? (
                <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Omitted files</p>
                  {walkthrough.omittedFiles.map((omitted) => (
                    <p key={omitted.file} className="text-xs text-muted-foreground">
                      {omitted.file} — {OMITTED_REASON_LABELS[omitted.reason]}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
})
