import { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { SideDrawer, SideDrawerHeader } from '@/components/ui/side-drawer'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { DiffLines } from '@/components/file-browser/DiffLines'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { useChangeWalkthrough, useGenerateChangeWalkthrough } from '@/hooks/useChangeWalkthrough'
import { GIT_STATUS_COLORS, GIT_STATUS_LABELS } from '@/lib/git-status-styles'
import { WalkthroughOmittedFileSchema } from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthrough,
  WalkthroughHunk,
  WalkthroughOmittedFile,
  WalkthroughStop,
} from '@opencode-manager/shared/schemas'

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

interface ChangesWalkthroughContextValue {
  isLoading: boolean
  walkthrough: ChangeWalkthrough | null
  stale: boolean
  generating: boolean
  error: unknown
  contextLimitFiles: WalkthroughOmittedFile[]
  generate: () => void
  regenerate: () => void
  stops: WalkthroughStop[]
  stopIndex: number | null
  selectedStop: WalkthroughStop | null
  selectedHunks: WalkthroughHunk[]
  selectStop: (index: number | null) => void
  scrollRef: RefObject<HTMLDivElement | null>
}

const ChangesWalkthroughContext = createContext<ChangesWalkthroughContextValue | null>(null)

function useChangesWalkthrough(): ChangesWalkthroughContextValue {
  const value = useContext(ChangesWalkthroughContext)
  if (!value) throw new Error('useChangesWalkthrough must be used within a ChangesWalkthroughProvider')
  return value
}

interface ChangesWalkthroughProviderProps {
  sessionId: string
  active: boolean
  children: ReactNode
}

/** Loads a session's change walkthrough and shares its state with the surrounding chrome and body. */
export function ChangesWalkthroughProvider({ sessionId, active, children }: ChangesWalkthroughProviderProps) {
  const stateQuery = useChangeWalkthrough(sessionId, active)
  const generate = useGenerateChangeWalkthrough(sessionId)
  const resetGenerate = generate.reset
  const [stopIndex, setStopIndex] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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
    setStopIndex(null)
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [active, sessionId, walkthrough?.createdAt])

  const hunksById = new Map(walkthrough?.hunks.map((hunk) => [hunk.id, hunk]) ?? [])
  const stops = walkthrough?.stops ?? []
  const clampedIndex = stopIndex === null || stops.length === 0 ? null : Math.min(stopIndex, stops.length - 1)
  const selectedStop = clampedIndex === null ? null : stops[clampedIndex] ?? null
  const selectedHunks = (selectedStop?.hunkIds ?? [])
    .map((id) => hunksById.get(id))
    .filter((hunk): hunk is WalkthroughHunk => hunk !== undefined)

  const selectStop = useCallback((index: number | null) => {
    setStopIndex(index)
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [])

  const value: ChangesWalkthroughContextValue = {
    isLoading: stateQuery.isLoading,
    walkthrough,
    stale,
    generating,
    error,
    contextLimitFiles,
    generate: () => generate.mutate({}),
    regenerate: () => generate.mutate({ regenerate: true }),
    stops,
    stopIndex: clampedIndex,
    selectedStop,
    selectedHunks,
    selectStop,
    scrollRef,
  }

  return <ChangesWalkthroughContext.Provider value={value}>{children}</ChangesWalkthroughContext.Provider>
}

/** Previous/next page controls (overview, then each stop) for the walkthrough chrome; renders nothing until a walkthrough has stops. */
export const ChangesWalkthroughNav = memo(function ChangesWalkthroughNav() {
  const { stops, stopIndex, selectStop } = useChangesWalkthrough()

  if (stops.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Previous stop"
        onClick={() => selectStop(stopIndex === null || stopIndex === 0 ? null : stopIndex - 1)}
        disabled={stopIndex === null}
      >
        <ChevronLeft />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Jump to page" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
            {stopIndex === null ? 'Overview' : `${stopIndex + 1} of ${stops.length}`}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={stopIndex === null ? 'overview' : String(stopIndex)}
            onValueChange={(value) => selectStop(value === 'overview' ? null : Number(value))}
          >
            <DropdownMenuRadioItem value="overview">Overview</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {stops.map((stop, index) => (
              <DropdownMenuRadioItem key={index} value={String(index)}>
                {index + 1}. {stop.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Next stop"
        onClick={() => selectStop(stopIndex === null ? 0 : stopIndex + 1)}
        disabled={stopIndex !== null && stopIndex >= stops.length - 1}
      >
        <ChevronRight />
      </Button>
    </div>
  )
})

/** Regenerates the current walkthrough from the chrome; renders nothing until one exists. */
export const ChangesWalkthroughRegenerate = memo(function ChangesWalkthroughRegenerate() {
  const { walkthrough, generating, regenerate } = useChangesWalkthrough()

  if (!walkthrough) return null

  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label="Regenerate walkthrough"
      onClick={regenerate}
      disabled={generating}
    >
      <RefreshCw className={generating ? 'animate-spin' : undefined} />
    </Button>
  )
})

/** Renders the walkthrough body; the provider and its chrome supply the surrounding panel. */
export const ChangesWalkthroughView = memo(function ChangesWalkthroughView() {
  const {
    isLoading,
    walkthrough,
    stale,
    generating,
    error,
    contextLimitFiles,
    generate,
    regenerate,
    stops,
    selectedStop,
    selectedHunks,
    selectStop,
    scrollRef,
  } = useChangesWalkthrough()

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
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

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !walkthrough ? (
        generating ? null : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Generate a step-by-step walkthrough of the changes in this session.
            </p>
            <Button onClick={generate}>Generate walkthrough</Button>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {stale && !generating ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
              <p className="text-sm text-warning">
                Changes have been updated since this walkthrough was generated
              </p>
              <Button variant="outline" size="sm" onClick={regenerate}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Regenerate
              </Button>
            </div>
          ) : null}

          {selectedStop ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{selectedStop.title}</h3>
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
          ) : (
            <>
              <ScheduleRunMarkdown content={walkthrough.summary} />

              {stops.length > 0 ? (
                <ol className="space-y-0.5">
                  {stops.map((stop, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        onClick={() => selectStop(index)}
                        className="w-full rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/20 hover:text-foreground"
                      >
                        {index + 1}. {stop.title}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}

              {walkthrough.omittedFiles.length > 0 ? <OmittedFiles files={walkthrough.omittedFiles} /> : null}
            </>
          )}
        </div>
      )}
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
      <ChangesWalkthroughProvider sessionId={sessionId} active={open}>
        <SideDrawerHeader
          title="Change walkthrough"
          onClose={close}
          actions={
            <>
              <ChangesWalkthroughRegenerate />
              <ChangesWalkthroughNav />
            </>
          }
        />
        <ChangesWalkthroughView />
      </ChangesWalkthroughProvider>
    </SideDrawer>
  )
}
