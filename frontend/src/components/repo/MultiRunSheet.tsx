import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Play, Search } from 'lucide-react'
import { SideDrawer, SideDrawerContent, SideDrawerHeader } from '@/components/ui/side-drawer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { BranchCombobox } from '@/components/repo/BranchCombobox'
import { ModelCheckboxList } from '@/components/repo/ModelCheckboxList'
import { MultiRunCard } from '@/components/repo/MultiRunCard'
import { FusionComposer, type FusionComposerSubmission } from '@/components/repo/FusionComposer'
import { ChangesWalkthroughDialog } from '@/components/session/ChangesWalkthroughDialog'
import { useModelSections } from '@/hooks/useModelSections'
import { useDiscardMultiRunEntry, useFuseMultiRun, useLaunchMultiRun, useMultiRuns } from '@/hooks/useMultiRuns'
import { filterModelSections } from '@/lib/modelSections'
import { randomId } from '@/lib/utils'
import { buildSessionPath } from '@opencode-manager/shared/utils'
import {
  FusionUnavailableDetailsSchema,
  MULTI_RUN_MAX_MODELS,
  type FuseMultiRunRequest,
  type LaunchMultiRunRequest,
  type MultiRunEntry,
} from '@opencode-manager/shared/schemas'

interface MultiRunSheetProps {
  repoId: number
  directory?: string
  defaultBaseRef?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SheetTab = 'runs' | 'new'

interface PendingDiscard {
  runId: number
  entry: MultiRunEntry
}

interface FusionSelection {
  runId: number
  entryIds: number[]
}

const NO_UNAVAILABLE_REASONS: ReadonlyMap<number, string> = new Map()

function unavailableReasonsFromError(error: unknown): ReadonlyMap<number, string> {
  const parsed = FusionUnavailableDetailsSchema.safeParse((error as { details?: unknown } | null)?.details)
  if (!parsed.success) return NO_UNAVAILABLE_REASONS
  return new Map(parsed.data.unavailableSources.map((source) => [source.entryId, source.message]))
}

export function MultiRunSheet({ repoId, directory, defaultBaseRef, open, onOpenChange }: MultiRunSheetProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SheetTab>('runs')
  const [expandedRuns, setExpandedRuns] = useState<Record<number, boolean>>({})
  const [selection, setSelection] = useState<FusionSelection | null>(null)
  const [fusionRequestId, setFusionRequestId] = useState(() => randomId())
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null)
  const [walkthroughSessionId, setWalkthroughSessionId] = useState<string | null>(null)

  const runsQuery = useMultiRuns(repoId, open)
  const fuse = useFuseMultiRun(repoId)
  const discard = useDiscardMultiRunEntry(repoId)
  const resetFuse = fuse.reset

  useEffect(() => {
    if (!open) return
    setActiveTab('runs')
    setExpandedRuns({})
    setSelection(null)
    resetFuse()
  }, [open, resetFuse])

  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data])
  const selectedRun = selection ? runs.find((run) => run.id === selection.runId) ?? null : null
  const unavailableReasons = useMemo(() => unavailableReasonsFromError(fuse.error), [fuse.error])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const openSession = (sessionId: string, isolated: boolean) => {
    onOpenChange(false)
    navigate(buildSessionPath(repoId, sessionId, isolated ? { repoTab: 'workspaces' } : undefined))
  }

  const startSelection = (runId: number) => {
    resetFuse()
    setFusionRequestId(randomId())
    setSelection({ runId, entryIds: [] })
  }

  const exitSelection = () => {
    resetFuse()
    setSelection(null)
  }

  const toggleEntry = (entryId: number, checked: boolean) => {
    resetFuse()
    setSelection((current) => {
      if (!current) return current
      if (!checked) return { ...current, entryIds: current.entryIds.filter((id) => id !== entryId) }
      if (current.entryIds.includes(entryId) || current.entryIds.length >= MULTI_RUN_MAX_MODELS) return current
      return { ...current, entryIds: [...current.entryIds, entryId] }
    })
  }

  const submitFusion = (submission: FusionComposerSubmission) => {
    if (!selection) return
    const request: FuseMultiRunRequest = {
      requestId: fusionRequestId,
      entryIds: selection.entryIds,
      model: submission.model,
      ...(submission.instructions ? { instructions: submission.instructions } : {}),
      ...(submission.baseRef ? { baseRef: submission.baseRef } : {}),
    }
    fuse.mutate(
      { runId: selection.runId, request },
      {
        onSuccess: (run) => {
          const fusion = run.fusions.find((candidate) => candidate.requestId === request.requestId)
          if (fusion?.status === 'started' && fusion.sessionId) {
            setSelection(null)
            openSession(fusion.sessionId, fusion.isolated)
          } else if (fusion?.status === 'failed') {
            setFusionRequestId(randomId())
          }
        },
      },
    )
  }

  const confirmDiscard = () => {
    if (!pendingDiscard) return
    discard.mutate(
      { runId: pendingDiscard.runId, entryId: pendingDiscard.entry.id },
      { onSuccess: () => setPendingDiscard(null) },
    )
  }

  return (
    <>
      <SideDrawer
        isOpen={open}
        onClose={close}
        side="right"
        widthClass="w-full sm:w-[min(640px,92vw)]"
        ariaLabel="Multi-run"
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SheetTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SideDrawerHeader
            title="Multi-run"
            onClose={close}
            meta={
              <TabsList className="mt-2 grid w-full grid-cols-2 sm:inline-grid sm:w-auto">
                <TabsTrigger value="runs">Runs</TabsTrigger>
                <TabsTrigger value="new">New run</TabsTrigger>
              </TabsList>
            }
          />

          <TabsContent forceMount value="runs" className="mt-0 flex min-h-0 flex-1 flex-col px-0 data-[state=inactive]:hidden">
            <SideDrawerContent className="space-y-3">
              {runsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : runsQuery.error ? (
                <p className="text-sm text-destructive">
                  {runsQuery.error instanceof Error ? runsQuery.error.message : 'Failed to load runs'}
                </p>
              ) : runs.length === 0 ? (
                <div className="space-y-3 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No runs yet.</p>
                  <Button variant="outline" onClick={() => setActiveTab('new')}>
                    Start a new run
                  </Button>
                </div>
              ) : (
                runs.map((run, index) => (
                  <MultiRunCard
                    key={run.id}
                    run={run}
                    expanded={expandedRuns[run.id] ?? index === 0}
                    onExpandedChange={(expanded) => setExpandedRuns((current) => ({ ...current, [run.id]: expanded }))}
                    selectedEntryIds={selection?.runId === run.id ? selection.entryIds : null}
                    unavailableReasons={selection?.runId === run.id ? unavailableReasons : NO_UNAVAILABLE_REASONS}
                    onStartSelection={() => startSelection(run.id)}
                    onExitSelection={exitSelection}
                    onToggleEntry={toggleEntry}
                    onOpenSession={openSession}
                    onWalkthrough={setWalkthroughSessionId}
                    onDiscard={(entry) => setPendingDiscard({ runId: run.id, entry })}
                  />
                ))
              )}
            </SideDrawerContent>

            {selection && selectedRun ? (
              <FusionComposer
                key={selectedRun.id}
                repoId={repoId}
                directory={directory}
                run={selectedRun}
                selectedEntryIds={selection.entryIds}
                isPending={fuse.isPending}
                error={fuse.error}
                onCancel={exitSelection}
                onSubmit={submitFusion}
                onOpenSession={openSession}
              />
            ) : null}
          </TabsContent>

          <TabsContent forceMount value="new" className="mt-0 flex min-h-0 flex-1 flex-col px-0 data-[state=inactive]:hidden">
            <NewRunForm
              repoId={repoId}
              directory={directory}
              defaultBaseRef={defaultBaseRef}
              open={open}
              onLaunched={() => setActiveTab('runs')}
            />
          </TabsContent>
        </Tabs>
      </SideDrawer>

      <ConfirmDestructiveDialog
        open={pendingDiscard !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDiscard(null)
        }}
        onConfirm={confirmDiscard}
        onCancel={() => setPendingDiscard(null)}
        title="Discard run"
        description={
          pendingDiscard?.entry.isolated
            ? 'Discard this run and remove its workspace directory? This action cannot be undone.'
            : 'Discard this run? This action cannot be undone.'
        }
        warning={pendingDiscard?.entry.model}
        confirmLabel="Discard"
        pendingLabel="Discarding..."
        isPending={discard.isPending}
      />

      {walkthroughSessionId ? (
        <ChangesWalkthroughDialog
          sessionId={walkthroughSessionId}
          open
          onOpenChange={(next) => {
            if (!next) setWalkthroughSessionId(null)
          }}
        />
      ) : null}
    </>
  )
}

interface NewRunFormProps {
  repoId: number
  directory?: string
  defaultBaseRef?: string
  open: boolean
  onLaunched: () => void
}

function NewRunForm({ repoId, directory, defaultBaseRef, open, onLaunched }: NewRunFormProps) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [isolate, setIsolate] = useState(true)
  const [baseRef, setBaseRef] = useState(defaultBaseRef ?? '')
  const [modelSearch, setModelSearch] = useState('')
  const deferredModelSearch = useDeferredValue(modelSearch)

  const { sections: modelSections } = useModelSections(directory, { enabled: open })
  const launch = useLaunchMultiRun(repoId)

  const visibleModelSections = useMemo(
    () => filterModelSections(modelSections, deferredModelSearch),
    [modelSections, deferredModelSearch],
  )

  const toggleModel = useCallback((value: string, checked: boolean) => {
    setSelectedModels((current) => {
      if (checked) {
        if (current.includes(value) || current.length >= MULTI_RUN_MAX_MODELS) return current
        return [...current, value]
      }
      return current.filter((model) => model !== value)
    })
  }, [])

  const canSubmit =
    name.trim().length > 0 && prompt.trim().length > 0 && selectedModels.length > 0 && !launch.isPending

  const handleLaunch = () => {
    if (!canSubmit) return
    const request: LaunchMultiRunRequest = {
      repoId,
      name: name.trim(),
      prompt: prompt.trim(),
      models: selectedModels,
      isolate,
      ...(isolate && baseRef ? { baseRef } : {}),
    }
    launch.mutate(request, { onSuccess: onLaunched })
  }

  return (
    <SideDrawerContent className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Run one prompt on up to {MULTI_RUN_MAX_MODELS} models at once, each in its own session.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="multi-run-name">Group name</Label>
        <Input id="multi-run-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sweep" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="multi-run-prompt">Prompt</Label>
        <Textarea
          id="multi-run-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="The prompt to send to every model"
          rows={4}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Models</Label>
          <span className="text-xs text-muted-foreground">
            {selectedModels.length}/{MULTI_RUN_MAX_MODELS} selected
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
            placeholder="Search models..."
            aria-label="Search models"
            autoComplete="off"
            className="pl-9"
          />
        </div>
        <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
          <ModelCheckboxList
            sections={visibleModelSections}
            selectedModels={selectedModels}
            onToggle={toggleModel}
            emptyLabel={modelSections.length === 0 ? 'No models available.' : 'No models match your search.'}
            maxSelected={MULTI_RUN_MAX_MODELS}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="multi-run-isolate">Isolate runs</Label>
          <p className="text-xs text-muted-foreground">Give each model its own workspace.</p>
        </div>
        <Switch id="multi-run-isolate" checked={isolate} onCheckedChange={setIsolate} />
      </div>

      {isolate ? (
        <div className="space-y-1.5">
          <Label htmlFor="multi-run-base-ref">Start from</Label>
          <BranchCombobox
            id="multi-run-base-ref"
            repoId={repoId}
            value={baseRef}
            onValueChange={setBaseRef}
            placeholder="Current HEAD"
            clearable
          />
          <p className="text-xs text-muted-foreground">Each isolated workspace starts from this branch.</p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button className="min-w-32" onClick={handleLaunch} disabled={!canSubmit} aria-busy={launch.isPending}>
          {launch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {launch.isPending ? 'Launching…' : 'Launch'}
        </Button>
      </div>
    </SideDrawerContent>
  )
}
