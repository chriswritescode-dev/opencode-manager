import { useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronRight, Combine, MoreVertical, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SessionStatusIndicator } from '@/components/ui/session-status-indicator'
import { cn, formatShortRelativeTime } from '@/lib/utils'
import { useSessionStatusForSession, type SessionStatusType } from '@/stores/sessionStatusStore'
import {
  MULTI_RUN_FUSION_MIN_SOURCES,
  MULTI_RUN_MAX_MODELS,
  type MultiRun,
  type MultiRunEntry,
  type MultiRunFusion,
  type MultiRunFusionStatus,
} from '@opencode-manager/shared/schemas'

type StatusTone = 'success' | 'warning' | 'destructive' | 'info' | 'muted'

interface EntryReadiness {
  ready: boolean
  label: string
  tone: StatusTone
  reason: string | null
}

interface MultiRunCardProps {
  run: MultiRun
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  selectedEntryIds: number[] | null
  unavailableReasons: ReadonlyMap<number, string>
  onStartSelection: () => void
  onExitSelection: () => void
  onToggleEntry: (entryId: number, checked: boolean) => void
  onOpenSession: (sessionId: string, isolated: boolean) => void
  onWalkthrough: (sessionId: string) => void
  onDiscard: (entry: MultiRunEntry) => void
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'border-success/40 text-success',
  warning: 'border-warning/40 text-warning',
  destructive: 'border-destructive/40 text-destructive',
  info: 'border-info/40 text-info',
  muted: 'border-border text-muted-foreground',
}

const FUSION_STATUS: Record<MultiRunFusionStatus, { label: string; tone: StatusTone }> = {
  starting: { label: 'Starting', tone: 'info' },
  started: { label: 'Started', tone: 'muted' },
  failed: { label: 'Failed', tone: 'destructive' },
}

const PROMPT_PREVIEW_LENGTH = 240

const HEADER_BUTTON_CLASS = 'h-7 px-2 text-xs'

/**
 * Derives the display status of a multi-run entry from its stored status and the
 * live session status. The stored `started` status only means the session was
 * launched; an entry reads as ready once its session is idle. The server remains
 * authoritative when a fusion is submitted.
 */
function describeEntryReadiness(entry: MultiRunEntry, live: SessionStatusType): EntryReadiness {
  switch (entry.status) {
    case 'discarded':
      return { ready: false, label: 'Discarded', tone: 'muted', reason: 'discarded' }
    case 'failed':
      return { ready: false, label: 'Failed', tone: 'destructive', reason: entry.error ?? 'no final reply' }
    case 'starting':
      return { ready: false, label: 'Starting', tone: 'info', reason: 'still starting' }
    case 'started':
      if (!entry.sessionId) {
        return { ready: false, label: 'Started', tone: 'muted', reason: 'no session recorded' }
      }
      if (live.type !== 'idle') {
        return { ready: false, label: 'Running', tone: 'warning', reason: 'still running — wait for a final reply' }
      }
      return { ready: true, label: 'Ready', tone: 'success', reason: null }
  }
}

interface RowActionProps {
  icon: LucideIcon
  label: string
  onClick: () => void
}

function RowAction({ icon: Icon, label, onClick }: RowActionProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      className="h-7 w-7 gap-1 px-0 text-xs sm:w-auto sm:px-2"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  )
}

function formatRunMeta(run: MultiRun): string {
  const parts = [
    `${run.entries.length} model${run.entries.length === 1 ? '' : 's'}`,
    run.isolated ? 'isolated' : 'repository checkout',
  ]
  if (run.isolated && run.baseRef) parts.push(`base ${run.baseRef}`)
  parts.push(formatShortRelativeTime(new Date(run.createdAt)))
  return parts.join(' · ')
}

export function MultiRunCard({
  run,
  expanded,
  onExpandedChange,
  selectedEntryIds,
  unavailableReasons,
  onStartSelection,
  onExitSelection,
  onToggleEntry,
  onOpenSession,
  onWalkthrough,
  onDiscard,
}: MultiRunCardProps) {
  const [promptExpanded, setPromptExpanded] = useState(false)
  const selecting = selectedEntryIds !== null
  const isOpen = expanded || selecting
  const launchedEntries = run.entries.filter((entry) => entry.status === 'started' && entry.sessionId).length
  const selectionFull = (selectedEntryIds?.length ?? 0) >= MULTI_RUN_MAX_MODELS
  const promptIsLong = run.prompt.length > PROMPT_PREVIEW_LENGTH

  return (
    <section
      aria-label={run.name}
      className={cn(
        'rounded-lg border bg-card',
        selecting ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2 px-3 py-3">
        <button
          type="button"
          aria-expanded={isOpen}
          disabled={selecting}
          onClick={() => onExpandedChange(!expanded)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <ChevronRight
            className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold text-foreground">{run.name}</span>
              {selecting ? (
                <span className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Selection mode
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{formatRunMeta(run)}</span>
          </span>
        </button>
        {selecting ? (
          <Button variant="outline" size="sm" className={HEADER_BUTTON_CLASS} onClick={onExitSelection}>
            Exit
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={HEADER_BUTTON_CLASS}
            disabled={launchedEntries < MULTI_RUN_FUSION_MIN_SOURCES}
            onClick={onStartSelection}
          >
            <Combine className="h-3.5 w-3.5" />
            Fuse results
          </Button>
        )}
      </div>

      {isOpen ? (
        <div className="border-t border-border">
          <div className="px-3 py-2">
            <p
              className={cn(
                'whitespace-pre-wrap break-words text-sm text-foreground/90',
                promptIsLong && !promptExpanded && 'line-clamp-3',
              )}
            >
              {run.prompt}
            </p>
            {promptIsLong ? (
              <button
                type="button"
                className="mt-1 text-xs font-medium text-primary hover:underline"
                onClick={() => setPromptExpanded((current) => !current)}
              >
                {promptExpanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </div>

          <ul className="divide-y divide-border border-t border-border">
            {run.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                selecting={selecting}
                checked={selectedEntryIds?.includes(entry.id) ?? false}
                selectionFull={selectionFull}
                unavailableReason={unavailableReasons.get(entry.id) ?? null}
                onToggle={(checked) => onToggleEntry(entry.id, checked)}
                onOpenSession={onOpenSession}
                onWalkthrough={onWalkthrough}
                onDiscard={() => onDiscard(entry)}
              />
            ))}
          </ul>

          {run.fusions.length > 0 ? (
            <div className="border-t border-border">
              <h4 className="flex items-center gap-2 px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fusions
                <span className="rounded-full border border-border px-1.5 text-[11px] font-medium normal-case">
                  {run.fusions.length}
                </span>
              </h4>
              <ul className="divide-y divide-border">
                {run.fusions.map((fusion) => (
                  <FusionRow
                    key={fusion.id}
                    fusion={fusion}
                    onOpenSession={onOpenSession}
                    onWalkthrough={onWalkthrough}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

interface EntryRowProps {
  entry: MultiRunEntry
  selecting: boolean
  checked: boolean
  selectionFull: boolean
  unavailableReason: string | null
  onToggle: (checked: boolean) => void
  onOpenSession: (sessionId: string, isolated: boolean) => void
  onWalkthrough: (sessionId: string) => void
  onDiscard: () => void
}

function EntryRow({
  entry,
  selecting,
  checked,
  selectionFull,
  unavailableReason,
  onToggle,
  onOpenSession,
  onWalkthrough,
  onDiscard,
}: EntryRowProps) {
  const live = useSessionStatusForSession(entry.sessionId ?? undefined)
  const readiness = describeEntryReadiness(entry, live)
  const reason = unavailableReason ?? readiness.reason
  const unavailable = unavailableReason !== null || !readiness.ready
  const sessionId = entry.sessionId
  const canDiscard = entry.status === 'started' || entry.status === 'failed'
  const isolationLabel = entry.isolated ? 'Isolated' : 'Repository checkout'

  const detail = selecting && unavailable
    ? `Unavailable · ${reason}`
    : entry.status === 'failed' && entry.error
      ? entry.error
      : null

  return (
    <li
      className={cn(
        'flex items-start gap-2 px-3 py-2.5',
        selecting && unavailable && !checked && 'opacity-60',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {selecting ? (
          <label className="-my-1 -ml-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center">
            <Checkbox
              aria-label={entry.model}
              checked={checked}
              disabled={!checked && (!readiness.ready || selectionFull)}
              onCheckedChange={(next) => onToggle(next === true)}
            />
          </label>
        ) : null}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium">{entry.model}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill label={readiness.label} tone={readiness.tone} />
            {readiness.label === 'Running' && sessionId ? <SessionStatusIndicator sessionID={sessionId} size="sm" /> : null}
            <span className="text-xs text-muted-foreground">{isolationLabel}</span>
          </div>
          {detail ? (
            <p className={cn('text-xs', entry.status === 'failed' || unavailableReason ? 'text-destructive' : 'text-muted-foreground')}>
              {detail}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {sessionId ? (
          <RowAction icon={ArrowUpRight} label="Open" onClick={() => onOpenSession(sessionId, entry.isolated)} />
        ) : null}
        {sessionId ? (
          <RowAction icon={BookOpen} label="Walkthrough" onClick={() => onWalkthrough(sessionId)} />
        ) : null}
        {canDiscard ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`More actions for ${entry.model}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDiscard}>
                <Trash2 className="h-4 w-4" />
                Discard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  )
}

interface FusionRowProps {
  fusion: MultiRunFusion
  onOpenSession: (sessionId: string, isolated: boolean) => void
  onWalkthrough: (sessionId: string) => void
}

function FusionRow({ fusion, onOpenSession, onWalkthrough }: FusionRowProps) {
  const truncated = fusion.sources.some((source) => source.truncated)
  const sessionId = fusion.sessionId
  const status = FUSION_STATUS[fusion.status]

  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{fusion.model}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill label={status.label} tone={status.tone} />
          {fusion.status === 'started' && sessionId ? <SessionStatusIndicator sessionID={sessionId} size="sm" /> : null}
          <span className="text-xs text-muted-foreground">
            <span>
              from {fusion.sources.length} source{fusion.sources.length === 1 ? '' : 's'}
              {truncated ? ' (truncated)' : ''}
            </span>
            <span> · {formatShortRelativeTime(new Date(fusion.createdAt))}</span>
          </span>
        </div>
        {fusion.status === 'failed' && fusion.error ? <p className="text-xs text-destructive">{fusion.error}</p> : null}
      </div>
      {sessionId ? (
        <div className="flex shrink-0 items-center gap-1">
          <RowAction icon={ArrowUpRight} label="Open" onClick={() => onOpenSession(sessionId, fusion.isolated)} />
          <RowAction icon={BookOpen} label="Walkthrough" onClick={() => onWalkthrough(sessionId)} />
        </div>
      ) : null}
    </li>
  )
}
