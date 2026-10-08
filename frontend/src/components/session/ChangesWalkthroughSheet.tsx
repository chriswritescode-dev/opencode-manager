import { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { SideDrawer, SideDrawerHeader } from '@/components/ui/side-drawer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DiffLines } from '@/components/file-browser/DiffLines'
import { ScheduleRunMarkdown } from '@/components/schedules/ScheduleRunMarkdown'
import { useChangeWalkthrough, useGenerateChangeWalkthrough } from '@/hooks/useChangeWalkthrough'
import { GIT_STATUS_COLORS, GIT_STATUS_LABELS } from '@/lib/git-status-styles'
import { cn } from '@/lib/utils'
import {
  DEFAULT_WALKTHROUGH_SOURCE,
  describeWalkthroughSource,
  toWalkthroughSource,
  walkthroughSourceKey,
  WalkthroughOmittedFileSchema,
} from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthrough,
  WalkthroughHunk,
  WalkthroughOmittedFile,
  WalkthroughSource,
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
  renamed: 'renamed',
  modeChange: 'mode change',
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

function isMechanicalHunk(hunk: WalkthroughHunk): boolean {
  return hunk.additions !== undefined || hunk.deletions !== undefined
}

function MechanicalHunks({ hunks }: { hunks: WalkthroughHunk[] }) {
  return (
    <ul aria-label="Mechanical file summaries" className="space-y-3">
      {hunks.map((hunk) => (
        <li key={hunk.id} className="overflow-hidden rounded-md border border-border">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={hunk.file}>
              {hunk.file}
            </span>
            <span className={`text-xs ${GIT_STATUS_COLORS[hunk.status]}`}>
              {GIT_STATUS_LABELS[hunk.status]}
            </span>
            <span className="text-xs text-diff-add">+{hunk.additions ?? 0}</span>
            <span className="text-xs text-diff-delete">-{hunk.deletions ?? 0}</span>
          </div>
          {hunk.text.length > 0 ? (
            <div className="overflow-x-auto border-t border-border">
              <DiffLines diff={hunk.text} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
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
  stopIndex: number
  selectedStop: WalkthroughStop | null
  selectedHunks: WalkthroughHunk[]
  selectStop: (index: number) => void
  detailRef: RefObject<HTMLDivElement | null>
  failedStopCount: number
  source: WalkthroughSource
  setSource: (source: WalkthroughSource) => void
  sourceKind: WalkthroughSource['kind']
  setSourceKind: (kind: WalkthroughSource['kind']) => void
  baseInput: string
  setBaseInput: (base: string) => void
  numberInput: string
  setNumberInput: (number: string) => void
  sourcePending: boolean
}

const ChangesWalkthroughContext = createContext<ChangesWalkthroughContextValue | null>(null)

function useChangesWalkthrough(): ChangesWalkthroughContextValue {
  const value = useContext(ChangesWalkthroughContext)
  if (!value) throw new Error('useChangesWalkthrough must be used within a ChangesWalkthroughProvider')
  return value
}

const WALKTHROUGH_SOURCE_OPTIONS: { value: WalkthroughSource['kind']; label: string }[] = [
  { value: 'session', label: 'This session' },
  { value: 'uncommitted', label: 'Uncommitted' },
  { value: 'staged', label: 'Staged' },
  { value: 'unstaged', label: 'Unstaged' },
  { value: 'branch', label: 'Branch vs base' },
  { value: 'pullRequest', label: 'Pull request' },
]

/** Chooses which set of changes the walkthrough covers; git sources commit as soon as they are valid. */
const WalkthroughSourcePicker = memo(function WalkthroughSourcePicker() {
  const {
    sourceKind,
    setSourceKind,
    baseInput,
    setBaseInput,
    numberInput,
    setNumberInput,
    setSource,
  } = useChangesWalkthrough()

  const commitInputs = useCallback(() => {
    const next = toWalkthroughSource({ kind: sourceKind, base: baseInput, number: Number(numberInput) })
    if (next) setSource(next)
  }, [sourceKind, baseInput, numberInput, setSource])

  const handleKindChange = useCallback(
    (next: WalkthroughSource['kind']) => {
      setSourceKind(next)
      if (next === 'pullRequest') return
      const nextSource = toWalkthroughSource({ kind: next, base: baseInput })
      if (nextSource) setSource(nextSource)
    },
    [baseInput, setSourceKind, setSource],
  )

  return (
    <div className="space-y-2">
      <Select
        value={sourceKind}
        onValueChange={(value) => handleKindChange(value as WalkthroughSource['kind'])}
      >
        <SelectTrigger aria-label="Changes to walk through">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WALKTHROUGH_SOURCE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {sourceKind === 'branch' || sourceKind === 'pullRequest' ? (
        <Input
          aria-label="Base branch"
          placeholder="Default branch"
          value={baseInput}
          onChange={(event) => setBaseInput(event.target.value)}
          onBlur={commitInputs}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitInputs()
          }}
        />
      ) : null}

      {sourceKind === 'pullRequest' ? (
        <Input
          type="number"
          aria-label="Pull request number"
          value={numberInput}
          onChange={(event) => setNumberInput(event.target.value)}
          onBlur={commitInputs}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitInputs()
          }}
        />
      ) : null}
    </div>
  )
})

interface ChangesWalkthroughProviderProps {
  sessionId: string
  active: boolean
  children: ReactNode
}

/** Loads a session's change walkthrough and shares its state with the surrounding chrome and body. */
export function ChangesWalkthroughProvider({ sessionId, active, children }: ChangesWalkthroughProviderProps) {
  const [source, setSource] = useState<WalkthroughSource>(DEFAULT_WALKTHROUGH_SOURCE)
  const [sourceKind, setSourceKind] = useState<WalkthroughSource['kind']>(DEFAULT_WALKTHROUGH_SOURCE.kind)
  const [baseInput, setBaseInput] = useState('')
  const [numberInput, setNumberInput] = useState('')
  const sourceKey = walkthroughSourceKey(source)
  const stateQuery = useChangeWalkthrough(sessionId, active, source)
  const generate = useGenerateChangeWalkthrough(sessionId, source)
  const resetGenerate = generate.reset
  const [stopIndex, setStopIndex] = useState(0)
  const detailRef = useRef<HTMLDivElement>(null)

  const state = stateQuery.data
  const walkthrough = state?.walkthrough ?? null
  const stale = state?.stale ?? false
  const generating = generate.isPending || (state?.generating ?? false)
  const error = generate.error ?? stateQuery.error ?? (generating ? null : state?.error ?? null)
  const contextLimitFiles = isContextLimitError(error) ? omittedFilesFromError(error) : []

  const selectedSource = toWalkthroughSource({ kind: sourceKind, base: baseInput, number: Number(numberInput) })
  const sourcePending =
    sourceKind === 'pullRequest' &&
    (selectedSource === null || walkthroughSourceKey(selectedSource) !== sourceKey)

  useEffect(() => {
    resetGenerate()
  }, [active, sessionId, sourceKey, resetGenerate])

  useEffect(() => {
    setStopIndex(0)
  }, [active, sessionId, sourceKey, walkthrough?.createdAt])

  const hunksById = new Map(walkthrough?.hunks.map((hunk) => [hunk.id, hunk]) ?? [])
  const stops = walkthrough?.stops ?? []
  const clampedIndex = stops.length > 0 ? Math.min(stopIndex, stops.length - 1) : 0
  const selectedStop = stops[clampedIndex] ?? null
  const selectedHunks = (selectedStop?.hunkIds ?? [])
    .map((id) => hunksById.get(id))
    .filter((hunk): hunk is WalkthroughHunk => hunk !== undefined)

  const failedStopCount = stops.filter(
    (stop) => stop.status === 'failed' || (stop.status === 'pending' && !generating),
  ).length

  const selectStop = useCallback((index: number) => {
    setStopIndex(index)
    detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
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
    detailRef,
    failedStopCount,
    source,
    setSource,
    sourceKind,
    setSourceKind,
    baseInput,
    setBaseInput,
    numberInput,
    setNumberInput,
    sourcePending,
  }

  return <ChangesWalkthroughContext.Provider value={value}>{children}</ChangesWalkthroughContext.Provider>
}

/** Previous/next stop controls for the walkthrough chrome; renders nothing until a walkthrough has stops. */
export const ChangesWalkthroughNav = memo(function ChangesWalkthroughNav() {
  const { stops, stopIndex, selectStop } = useChangesWalkthrough()

  if (stops.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Previous stop"
        onClick={() => selectStop(stopIndex - 1)}
        disabled={stopIndex === 0}
      >
        <ChevronLeft />
      </Button>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        Stop {stopIndex + 1} of {stops.length}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Next stop"
        onClick={() => selectStop(stopIndex + 1)}
        disabled={stopIndex >= stops.length - 1}
      >
        <ChevronRight />
      </Button>
    </div>
  )
})

/** Regenerates the current walkthrough from the chrome; renders nothing until one exists. */
export const ChangesWalkthroughRegenerate = memo(function ChangesWalkthroughRegenerate() {
  const { walkthrough, generating, regenerate, sourcePending } = useChangesWalkthrough()

  if (!walkthrough) return null

  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label="Regenerate walkthrough"
      onClick={regenerate}
      disabled={generating || sourcePending}
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
    stops,
    stopIndex,
    selectedStop,
    selectedHunks,
    selectStop,
    detailRef,
    failedStopCount,
    source,
    sourcePending,
  } = useChangesWalkthrough()

  const readyStopCount = stops.filter((stop) => stop.status === 'ready').length
  const mechanicalHunks = selectedHunks.filter(isMechanicalHunk)
  const diffHunks = selectedHunks.filter((hunk) => !isMechanicalHunk(hunk))

  if (sourcePending) {
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <WalkthroughSourcePicker />
        <p className="text-sm text-muted-foreground">Enter a pull request number</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <WalkthroughSourcePicker />

      {error ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{walkthroughErrorMessage(error)}</p>
          {contextLimitFiles.length > 0 ? <OmittedFiles files={contextLimitFiles} /> : null}
        </div>
      ) : null}

      {generating ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>
            {walkthrough && stops.length > 0
              ? `Generating walkthrough… ${readyStopCount} of ${stops.length} stops explained`
              : 'Generating walkthrough… this can take a minute or two.'}
          </span>
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
              Generate a step-by-step walkthrough of {describeWalkthroughSource(source)}.
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
              <Button variant="outline" size="sm" onClick={generate}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Update walkthrough
              </Button>
            </div>
          ) : null}

          {failedStopCount > 0 && !generating ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
              <p className="text-sm text-muted-foreground">Some stops could not be explained</p>
              <Button variant="outline" size="sm" onClick={generate}>
                Retry unexplained stops
              </Button>
            </div>
          ) : null}

          <ScheduleRunMarkdown content={walkthrough.summary} />

          {stops.length > 0 ? (
            <ol className="space-y-0.5">
              {stops.map((stop, index) => (
                <li key={stop.id}>
                  <button
                    type="button"
                    onClick={() => selectStop(index)}
                    aria-current={index === stopIndex}
                    className={cn(
                      'w-full rounded-md px-2 py-1 text-left text-sm',
                      index === stopIndex
                        ? 'bg-accent/40 font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-accent/20',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {index + 1}. {stop.title}
                      </span>
                      {stop.status === 'pending' && generating ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label="Explaining" />
                      ) : stop.status === 'failed' || stop.status === 'pending' ? (
                        <span className="shrink-0 text-xs text-muted-foreground">not explained</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}

          {selectedStop ? (
            <div ref={detailRef} className="scroll-mt-4 space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground">
                {stopIndex + 1}. {selectedStop.title}
              </h3>
              {selectedStop.status === 'ready' ? (
                <ScheduleRunMarkdown content={selectedStop.explanation} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {generating ? 'Explaining this stop…' : 'This stop could not be explained.'}
                </p>
              )}
              {mechanicalHunks.length > 0 ? <MechanicalHunks hunks={mechanicalHunks} /> : null}
              {diffHunks.map((hunk) => (
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
      <ChangesWalkthroughProvider key={sessionId} sessionId={sessionId} active={open}>
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
