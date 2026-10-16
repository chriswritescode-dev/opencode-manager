import { createContext, memo, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Loader2, RefreshCw, Square } from 'lucide-react'
import { SideDrawer, SideDrawerHeader } from '@/components/ui/side-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SandboxedHtmlFrame } from '@/components/ui/sandboxed-html-frame'
import { getFileApiUrl } from '@/api/files'
import {
  useCancelChangeWalkthrough,
  useChangeWalkthrough,
  useGenerateChangeWalkthrough,
  useRefineChangeWalkthrough,
} from '@/hooks/useChangeWalkthrough'
import {
  DEFAULT_WALKTHROUGH_SOURCE,
  describeWalkthroughSource,
  toWalkthroughSource,
  walkthroughSourceKey,
  WALKTHROUGH_REFINE_MAX_CHARS,
} from '@opencode-manager/shared/schemas'
import type { ChangeWalkthrough, WalkthroughSource } from '@opencode-manager/shared/schemas'
import { formatOpenCodeModelRef, type ModelRef } from '@opencode-manager/shared/opencode'

interface WalkthroughErrorLike {
  message?: string
  code?: string
}

function errorCode(error: unknown): string | undefined {
  return (error as WalkthroughErrorLike | null)?.code
}

function isNoChangesError(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'WALKTHROUGH_NO_CHANGES' || code === 'WALKTHROUGH_NO_TEXT_CHANGES'
}

function walkthroughErrorMessage(error: unknown): string {
  const message = (error as WalkthroughErrorLike | null)?.message
  if (isNoChangesError(error)) {
    return message || 'This session has no text changes to walk through'
  }
  return message || 'Failed to load the walkthrough'
}

interface ChangesWalkthroughContextValue {
  isLoading: boolean
  walkthrough: ChangeWalkthrough | null
  stale: boolean
  generating: boolean
  running: boolean
  error: unknown
  generate: () => void
  regenerate: () => void
  stop: () => void
  stopping: boolean
  refine: (text: string) => void
  refining: boolean
  onOpenSession?: (walkthroughSessionId: string) => void
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

/** Chooses which set of changes the walkthrough covers from the surrounding chrome; git sources commit as soon as they are valid. */
export const ChangesWalkthroughSourcePicker = memo(function ChangesWalkthroughSourcePicker() {
  const { sourceKind, setSourceKind, baseInput, setSource } = useChangesWalkthrough()

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
    <Select value={sourceKind} onValueChange={(value) => handleKindChange(value as WalkthroughSource['kind'])}>
      <SelectTrigger
        aria-label="Changes to walk through"
        className="h-7 w-auto gap-1 px-2 text-xs md:text-xs"
      >
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
  )
})

/** Collects the base branch or pull request number for git-backed walkthrough sources. */
const WalkthroughSourceInputs = memo(function WalkthroughSourceInputs() {
  const { sourceKind, baseInput, setBaseInput, numberInput, setNumberInput, setSource } =
    useChangesWalkthrough()

  const commitInputs = useCallback(() => {
    const next = toWalkthroughSource({ kind: sourceKind, base: baseInput, number: Number(numberInput) })
    if (next) setSource(next)
  }, [sourceKind, baseInput, numberInput, setSource])

  if (sourceKind !== 'branch' && sourceKind !== 'pullRequest') return null

  return (
    <div className="space-y-2">
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

/**
 * A one-shot request to open the walkthrough on a given source. A new request object re-applies, so a
 * repeated request for the same source takes effect; `source` undefined leaves the selection alone.
 */
export interface WalkthroughSourceRequest {
  sessionId: string
  source?: WalkthroughSource
}

interface ChangesWalkthroughProviderProps {
  sessionId: string
  active: boolean
  sourceRequest?: WalkthroughSourceRequest
  model?: ModelRef | null
  onOpenSession?: (walkthroughSessionId: string) => void
  children: ReactNode
}

/** Loads a session's change walkthrough and shares its state with the surrounding chrome and body. */
export function ChangesWalkthroughProvider({
  sessionId,
  active,
  sourceRequest,
  model,
  onOpenSession,
  children,
}: ChangesWalkthroughProviderProps) {
  const [source, setSource] = useState<WalkthroughSource>(DEFAULT_WALKTHROUGH_SOURCE)
  const [sourceKind, setSourceKind] = useState<WalkthroughSource['kind']>(DEFAULT_WALKTHROUGH_SOURCE.kind)
  const [baseInput, setBaseInput] = useState('')
  const [numberInput, setNumberInput] = useState('')
  const sourceKey = walkthroughSourceKey(source)
  const stateQuery = useChangeWalkthrough(sessionId, active, source)
  const generate = useGenerateChangeWalkthrough(sessionId, source)
  const cancel = useCancelChangeWalkthrough(sessionId, source)
  const refineMutation = useRefineChangeWalkthrough(sessionId, source)
  const stop = useCallback(() => cancel.mutate(), [cancel])
  const resetGenerate = generate.reset
  const resetRefine = refineMutation.reset

  const state = stateQuery.data
  const walkthrough = state?.walkthrough ?? null
  const stale = state?.stale ?? false
  const generating = generate.isPending || refineMutation.isPending || (state?.generating ?? false)
  const running = refineMutation.isPending || (state?.running ?? false)
  const error =
    generate.error ?? refineMutation.error ?? stateQuery.error ?? (generating ? null : state?.error ?? null)

  const selectedSource = toWalkthroughSource({ kind: sourceKind, base: baseInput, number: Number(numberInput) })
  const sourcePending =
    sourceKind === 'pullRequest' &&
    (selectedSource === null || walkthroughSourceKey(selectedSource) !== sourceKey)

  useEffect(() => {
    resetGenerate()
    resetRefine()
  }, [active, sessionId, sourceKey, resetGenerate, resetRefine])

  useEffect(() => {
    if (!sourceRequest) return
    const requested = sourceRequest.source
    if (!requested) return
    setSource(requested)
    setSourceKind(requested.kind)
    if (requested.kind === 'branch' || requested.kind === 'pullRequest') {
      setBaseInput(requested.base ?? '')
    }
    if (requested.kind === 'pullRequest') {
      setNumberInput(String(requested.number))
    }
  }, [sourceRequest])

  const modelRequest = model ? { model: formatOpenCodeModelRef(model) } : {}

  const value: ChangesWalkthroughContextValue = {
    isLoading: stateQuery.isLoading,
    walkthrough,
    stale,
    generating,
    running,
    error,
    generate: () => generate.mutate(modelRequest),
    regenerate: () => generate.mutate({ ...modelRequest, regenerate: true }),
    stop,
    stopping: cancel.isPending,
    refine: (text: string) => refineMutation.mutate(text),
    refining: refineMutation.isPending,
    onOpenSession,
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

/** Stops the in-flight walkthrough session from the chrome; renders nothing when the walkthrough is neither generating nor running. */
export const ChangesWalkthroughCancel = memo(function ChangesWalkthroughCancel() {
  const { generating, running, stopping, stop } = useChangesWalkthrough()

  if (!generating && !running) return null

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Stop generating walkthrough"
      onClick={stop}
      disabled={stopping}
      className="h-7 gap-1 px-2 text-xs"
    >
      <Square className="h-3.5 w-3.5" />
      {stopping ? 'Stopping…' : 'Stop'}
    </Button>
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
    running,
    error,
    generate,
    refine,
    refining,
    onOpenSession,
    source,
    sourcePending,
  } = useChangesWalkthrough()
  const [reload, setReload] = useState(0)
  const [refineText, setRefineText] = useState('')

  const artifactPath = walkthrough?.artifactPath ?? null
  const published = walkthrough?.publishedAt != null && artifactPath !== null
  const artifactUrl = artifactPath === null ? null : getFileApiUrl(artifactPath, { params: { raw: true } })
  const walkthroughSessionId = walkthrough?.walkthroughSessionId ?? null

  const openSession =
    walkthroughSessionId && onOpenSession
      ? () => onOpenSession(walkthroughSessionId)
      : null

  if (sourcePending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <WalkthroughSourceInputs />
        <p className="text-sm text-muted-foreground">Enter a pull request number</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <WalkthroughSourceInputs />

      {error ? <p className="text-sm text-destructive">{walkthroughErrorMessage(error)}</p> : null}

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

      {isLoading && !walkthrough && !generating ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Loading the walkthrough…
        </p>
      ) : null}

      {!isLoading && !walkthrough && !generating ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Build an interactive walkthrough of {describeWalkthroughSource(source)}.
          </p>
          <Button onClick={generate}>Generate walkthrough</Button>
        </div>
      ) : null}

      {generating && !published ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
          <span role="status" aria-live="polite">
            Building the walkthrough in a separate session…
          </span>
          {openSession ? (
            <Button variant="outline" size="sm" className="ml-auto" onClick={openSession}>
              Open walkthrough session
            </Button>
          ) : null}
        </div>
      ) : null}

      {published && artifactUrl !== null ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Reload walkthrough"
              onClick={() => setReload((value) => value + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={artifactUrl} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
            </Button>
            {openSession ? (
              <Button variant="outline" size="sm" onClick={openSession}>
                Open walkthrough session
              </Button>
            ) : null}
            {generating || running ? (
              <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
                Refining…
              </span>
            ) : null}
          </div>
          <SandboxedHtmlFrame
            src={artifactUrl}
            title="Change walkthrough"
            reloadKey={`${walkthrough?.publishedAt}:${reload}`}
            className="min-h-0 flex-1"
          />
        </div>
      ) : null}

      {walkthroughSessionId && !generating && !running ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            const text = refineText.trim()
            if (text.length === 0 || refining) return
            refine(text)
            setRefineText('')
          }}
        >
          <Textarea
            aria-label="Refine walkthrough"
            placeholder="Ask for a change to the walkthrough"
            maxLength={WALKTHROUGH_REFINE_MAX_CHARS}
            value={refineText}
            onChange={(event) => setRefineText(event.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={refineText.trim().length === 0 || refining}>
              {refining ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
})

interface ChangesWalkthroughSheetProps {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceRequest?: WalkthroughSourceRequest
  model?: ModelRef | null
  onOpenSession?: (walkthroughSessionId: string) => void
}

/** The walkthrough as a right-side sheet: full screen on mobile, a drawer over the page on desktop. */
export function ChangesWalkthroughSheet({
  sessionId,
  open,
  onOpenChange,
  sourceRequest,
  model,
  onOpenSession,
}: ChangesWalkthroughSheetProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  return (
    <SideDrawer isOpen={open} onClose={close} side="right" widthClass="w-full sm:w-[min(640px,92vw)]" ariaLabel="Change walkthrough">
      <ChangesWalkthroughProvider
        key={sessionId}
        sessionId={sessionId}
        active={open}
        sourceRequest={sourceRequest}
        model={model}
        onOpenSession={onOpenSession}
      >
        <SideDrawerHeader
          title="Change walkthrough"
          onClose={close}
          actions={
            <>
              <ChangesWalkthroughSourcePicker />
              <ChangesWalkthroughCancel />
              <ChangesWalkthroughRegenerate />
            </>
          }
        />
        <ChangesWalkthroughView />
      </ChangesWalkthroughProvider>
    </SideDrawer>
  )
}
