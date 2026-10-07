import { useId, useState } from 'react'
import { ArrowRight, ArrowUpRight, Combine, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ModelCombobox } from '@/components/model/ModelCombobox'
import { BranchCombobox } from '@/components/repo/BranchCombobox'
import { cn } from '@/lib/utils'
import {
  FUSION_INSTRUCTIONS_MAX_LENGTH,
  FusionRecoveredDetailsSchema,
  MULTI_RUN_FUSION_MIN_SOURCES,
  type MultiRun,
} from '@opencode-manager/shared/schemas'

export interface FusionComposerSubmission {
  model: string
  baseRef: string
  instructions: string
}

interface FusionComposerProps {
  repoId: number
  directory?: string
  run: MultiRun
  selectedEntryIds: number[]
  isPending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (submission: FusionComposerSubmission) => void
  onOpenSession: (sessionId: string, isolated: boolean) => void
}

const UPWARD_LIST_CLASS = 'bottom-full mt-0 mb-1'

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code
}

export function FusionComposer({
  repoId,
  directory,
  run,
  selectedEntryIds,
  isPending,
  error,
  onCancel,
  onSubmit,
  onOpenSession,
}: FusionComposerProps) {
  const optionsId = useId()
  const [model, setModel] = useState('')
  const [baseRef, setBaseRef] = useState(run.baseRef ?? '')
  const [instructions, setInstructions] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)

  const totalEntries = run.entries.filter((entry) => entry.status !== 'discarded').length
  const canSubmit = selectedEntryIds.length >= MULTI_RUN_FUSION_MIN_SOURCES && model !== '' && !isPending

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({ model, baseRef, instructions: instructions.trim() })
  }

  return (
    <div className="shrink-0 space-y-3 border-t border-border bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <div id={optionsId} className={cn('space-y-3', !optionsOpen && 'hidden sm:block')}>
        <div className="space-y-1.5">
          <Label htmlFor="fusion-model">Synthesis model</Label>
          <ModelCombobox
            id="fusion-model"
            ariaLabel="Synthesis model"
            value={model}
            onChange={setModel}
            directory={directory}
            placeholder="Select a model"
            allowCustomValue={false}
            emptyMeansDefault={false}
            listClassName={UPWARD_LIST_CLASS}
          />
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="fusion-base-ref" className="shrink-0">
            Base ref
          </Label>
          <div className="min-w-0 flex-1">
            <BranchCombobox
              id="fusion-base-ref"
              repoId={repoId}
              value={baseRef}
              onValueChange={setBaseRef}
              placeholder="Current HEAD"
              clearable
              listClassName={UPWARD_LIST_CLASS}
            />
          </div>
        </div>

        <details className="group rounded-md border border-border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Instructions (optional)</summary>
          <div className="px-3 pb-3">
            <Textarea
              aria-label="Instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={FUSION_INSTRUCTIONS_MAX_LENGTH}
              placeholder="Optional guidance for the synthesis"
              rows={3}
            />
          </div>
        </details>
      </div>

      {error ? <ComposerError error={error} run={run} onOpenSession={onOpenSession} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground sm:font-normal sm:text-muted-foreground">
            {selectedEntryIds.length} of {totalEntries} selected
          </span>
          <span className="sm:hidden">
            {' '}
            <ArrowRight className="inline h-3 w-3" aria-hidden="true" /> {model || 'no model'} · new worktree
          </span>
          <span className="hidden sm:inline">
            {' '}
            · runs in a new worktree; blank base ref uses the current HEAD; sources are never modified.
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Button
            variant="outline"
            className="h-9 sm:hidden"
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            onClick={() => setOptionsOpen((current) => !current)}
          >
            Options
          </Button>
          <Button variant="outline" className="hidden sm:inline-flex" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="h-9" disabled={!canSubmit} aria-busy={isPending} onClick={handleSubmit}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Combine className="h-4 w-4" />}
            Start fusion
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ComposerErrorProps {
  error: unknown
  run: MultiRun
  onOpenSession: (sessionId: string, isolated: boolean) => void
}

function ComposerError({ error, run, onOpenSession }: ComposerErrorProps) {
  const code = errorCode(error)

  if (code === 'FUSION_SOURCES_UNAVAILABLE') {
    return <p className="text-sm text-destructive">Some selected results are not ready to fuse. See the marked rows.</p>
  }

  if (code === 'FUSION_CONTEXT_LIMIT') {
    return <p className="text-sm text-destructive">Too much context: select fewer sources or shorten instructions</p>
  }

  if (code === 'FUSION_ATTEMPT_RECOVERED') {
    const parsed = FusionRecoveredDetailsSchema.safeParse((error as { details?: unknown }).details)
    const recovered = parsed.success ? parsed.data.fusions : []
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-destructive">An earlier attempt is already running.</p>
        {recovered.map((item) => {
          const isolated = run.fusions.find((fusion) => fusion.id === item.fusionId)?.isolated ?? false
          return (
            <Button
              key={item.fusionId}
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => onOpenSession(item.sessionId, isolated)}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Open
            </Button>
          )
        })}
      </div>
    )
  }

  return (
    <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to start fusion'}</p>
  )
}
