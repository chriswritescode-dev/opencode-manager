import { useState } from 'react'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  useCancelSessionGoal,
  usePauseSessionGoal,
  useResumeSessionGoal,
  useSessionGoal,
} from '@/hooks/useSessionGoals'
import { getGoalOutcomeTitle, getGoalStopReasonLabel, getGoalTokenLabel, getGoalTurnLabel } from '@opencode-manager/shared/notifications'
import type { SessionGoalStatus } from '@opencode-manager/shared/schemas'

const STATUS_CHIP_CLASSES: Record<SessionGoalStatus, string> = {
  active: 'bg-highlight text-highlight-foreground border-highlight',
  paused: 'bg-warning/15 text-warning border-warning/40',
  completed: 'bg-success/15 text-success border-success/40',
  blocked: 'bg-destructive/15 text-destructive border-destructive/40',
  stopped: 'bg-muted text-muted-foreground border-border',
}

const TERMINAL_STATUSES: SessionGoalStatus[] = ['completed', 'blocked', 'stopped']

function isTerminal(status: SessionGoalStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function SessionGoalBar({ sessionID }: { sessionID: string }) {
  const { data: goal } = useSessionGoal(sessionID)
  const pauseGoal = usePauseSessionGoal()
  const resumeGoal = useResumeSessionGoal()
  const cancelGoal = useCancelSessionGoal()
  const [expanded, setExpanded] = useState(false)
  const [dismissedGoalId, setDismissedGoalId] = useState<number | null>(null)

  if (!goal) return null
  if (isTerminal(goal.status) && dismissedGoalId === goal.id) return null

  const terminal = isTerminal(goal.status)
  const reason = goal.stopReason ? getGoalStopReasonLabel(goal.stopReason) : goal.lastReason
  const tokenLabel = getGoalTokenLabel(goal)

  return (
    <div className="mb-1 flex flex-col gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`gap-1 px-2 py-0.5 font-medium ${STATUS_CHIP_CLASSES[goal.status]}`}
        >
          <Target className="h-3 w-3" />
          {getGoalOutcomeTitle(goal.status)}
        </Badge>

        {!terminal && (
          <span className="text-muted-foreground">
            {getGoalTurnLabel(goal)}
          </span>
        )}

        {!terminal && tokenLabel !== null && (
          <span className="text-muted-foreground">
            {tokenLabel}
          </span>
        )}

        {terminal ? (
          <>
            {reason && (
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={reason}>
                {reason}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => setDismissedGoalId(goal.id)}
            >
              Dismiss
            </Button>
          </>
        ) : (
          <div className="ml-auto flex items-center gap-1">
            {goal.status === 'paused' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={resumeGoal.isPending}
                onClick={() => resumeGoal.mutate(goal.id)}
              >
                Resume
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={pauseGoal.isPending}
                onClick={() => pauseGoal.mutate(goal.id)}
              >
                Pause
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
              disabled={cancelGoal.isPending}
              onClick={() => cancelGoal.mutate(goal.id)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {!terminal && (
        <div className="flex items-start gap-1">
          <p className={`min-w-0 flex-1 text-muted-foreground ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
            {goal.objective}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse goal objective' : 'Expand goal objective'}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      )}

      {!terminal && goal.lastReason && (
        <p className="truncate text-muted-foreground" title={goal.lastReason}>
          {goal.lastReason}
        </p>
      )}
    </div>
  )
}
