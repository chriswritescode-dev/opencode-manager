import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { BranchCombobox } from '@/components/repo/BranchCombobox'
import { ModelCheckboxList } from '@/components/repo/ModelCheckboxList'
import { useModelSections } from '@/hooks/useModelSections'
import { useFuseMultiRun } from '@/hooks/useMultiRuns'
import { filterModelSections } from '@/lib/modelSections'
import { randomId } from '@/lib/utils'
import {
  FUSION_INSTRUCTIONS_MAX_LENGTH,
  FusionUnavailableDetailsSchema,
  MULTI_RUN_FUSION_MIN_SOURCES,
  type FuseMultiRunRequest,
  type MultiRun,
  type MultiRunEntryStatus,
} from '@opencode-manager/shared/schemas'

interface FuseRunDialogProps {
  repoId: number
  directory?: string
  run: MultiRun
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSession: (sessionId: string, isolated: boolean) => void
}

const ENTRY_STATUS_LABELS: Record<MultiRunEntryStatus, string> = {
  starting: 'Starting',
  started: 'Started',
  failed: 'Failed',
  discarded: 'Discarded',
}

function unavailableDetails(error: unknown) {
  const parsed = FusionUnavailableDetailsSchema.safeParse((error as { details?: unknown } | null)?.details)
  return parsed.success ? parsed.data : null
}

export function FuseRunDialog({
  repoId,
  directory,
  run,
  open,
  onOpenChange,
  onOpenSession,
}: FuseRunDialogProps) {
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [instructions, setInstructions] = useState('')
  const [isolate, setIsolate] = useState(true)
  const [baseRef, setBaseRef] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [requestId, setRequestId] = useState(() => randomId())
  const deferredModelSearch = useDeferredValue(modelSearch)

  const fuse = useFuseMultiRun(repoId)
  const { sections: modelSections } = useModelSections(directory, { enabled: open })

  useEffect(() => {
    if (!open) return
    setSelectedEntryIds([])
    setSelectedModel(null)
    setInstructions('')
    setIsolate(true)
    setBaseRef(run.baseRef ?? '')
    setModelSearch('')
    setRequestId(randomId())
  }, [open, run.id, run.baseRef])

  const visibleModelSections = useMemo(
    () => filterModelSections(modelSections, deferredModelSearch),
    [modelSections, deferredModelSearch],
  )
  const selectedModels = useMemo(() => (selectedModel ? [selectedModel] : []), [selectedModel])

  const requiresIsolation = useMemo(
    () => run.entries.some((entry) => selectedEntryIds.includes(entry.id) && !entry.isolated),
    [run.entries, selectedEntryIds],
  )
  const effectiveIsolate = requiresIsolation || isolate

  const toggleEntry = useCallback((entryId: number, checked: boolean) => {
    setSelectedEntryIds((current) => {
      if (checked) {
        if (current.includes(entryId)) return current
        return [...current, entryId]
      }
      return current.filter((id) => id !== entryId)
    })
  }, [])

  const toggleModel = useCallback((value: string, checked: boolean) => {
    setSelectedModel(checked ? value : null)
  }, [])

  const canSubmit =
    selectedEntryIds.length >= MULTI_RUN_FUSION_MIN_SOURCES && selectedModel !== null && !fuse.isPending

  const handleSubmit = () => {
    if (!selectedModel) return
    const trimmedInstructions = instructions.trim()
    const request: FuseMultiRunRequest = {
      requestId,
      entryIds: selectedEntryIds,
      model: selectedModel,
      ...(trimmedInstructions ? { instructions: trimmedInstructions } : {}),
      isolate: effectiveIsolate,
      ...(effectiveIsolate && baseRef ? { baseRef } : {}),
    }
    fuse.mutate(
      { runId: run.id, request },
      {
        onSuccess: (result) => {
          const fusion = result.fusions.find((candidate) => candidate.requestId === requestId)
          if (fusion?.status === 'started' && fusion.sessionId) {
            onOpenChange(false)
            onOpenSession(fusion.sessionId, fusion.isolated)
          } else if (fusion?.status === 'failed') {
            setRequestId(randomId())
          }
        },
      },
    )
  }

  const details = unavailableDetails(fuse.error)
  const errorCode = (fuse.error as { code?: string } | null)?.code

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen keyboardAware className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b shrink-0">
          <DialogTitle>Fuse results</DialogTitle>
          <DialogDescription>
            Ask one model to synthesise the selected results from “{run.name}”.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="space-y-2">
            <Label>Sources</Label>
            <div className="divide-y divide-border rounded-md border border-border">
              {run.entries.map((entry) => {
                const selectable = entry.status === 'started' && !!entry.sessionId
                return (
                  <label key={entry.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Checkbox
                      aria-label={entry.model}
                      checked={selectedEntryIds.includes(entry.id)}
                      disabled={!selectable}
                      onCheckedChange={(next) => toggleEntry(entry.id, next === true)}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.model}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {entry.sessionId ? <SessionStatusIndicator sessionID={entry.sessionId} size="sm" /> : null}
                      <span className="text-xs text-muted-foreground">{ENTRY_STATUS_LABELS[entry.status]}</span>
                    </div>
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Select at least {MULTI_RUN_FUSION_MIN_SOURCES} completed results.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Synthesis model</Label>
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
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fusion-instructions">Instructions</Label>
            <Textarea
              id="fusion-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={FUSION_INSTRUCTIONS_MAX_LENGTH}
              placeholder="Optional guidance for the synthesis"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="fusion-isolate">Isolated workspace</Label>
              <p className="text-xs text-muted-foreground">
                {requiresIsolation
                  ? 'Isolation is required because a selected result ran in the repository checkout'
                  : 'Run the synthesis in its own workspace.'}
              </p>
            </div>
            <Switch
              id="fusion-isolate"
              checked={effectiveIsolate}
              disabled={requiresIsolation}
              onCheckedChange={setIsolate}
            />
          </div>

          {effectiveIsolate ? (
            <div className="space-y-1.5">
              <Label htmlFor="fusion-base-ref">Start from</Label>
              <BranchCombobox
                id="fusion-base-ref"
                repoId={repoId}
                value={baseRef}
                onValueChange={setBaseRef}
                placeholder="Current HEAD"
                clearable
              />
              <p className="text-xs text-muted-foreground">
                {baseRef ? `Starts from ${baseRef}` : 'Starts from current HEAD'}; source workspaces are not modified
                or merged.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Runs in the repository checkout.</p>
          )}

          {fuse.error ? (
            <div className="space-y-1">
              {details ? (
                details.unavailableSources.map((source) => (
                  <p key={source.entryId} className="text-sm text-destructive">
                    {source.model}: {source.message}
                  </p>
                ))
              ) : errorCode === 'FUSION_CONTEXT_LIMIT' ? (
                <p className="text-sm text-destructive">Too much context: select fewer sources or shorten instructions</p>
              ) : errorCode === 'FUSION_ATTEMPT_RECOVERED' ? (
                <p className="text-sm text-destructive">
                  An earlier attempt is already running. Open it from the Fusions list.
                </p>
              ) : (
                <p className="text-sm text-destructive">
                  {fuse.error instanceof Error ? fuse.error.message : 'Failed to start fusion'}
                </p>
              )}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {fuse.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Fusing...
                </>
              ) : (
                'Fuse'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
