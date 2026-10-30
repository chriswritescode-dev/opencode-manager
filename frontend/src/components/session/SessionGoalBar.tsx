import { useState } from 'react'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useSessionGoal, useSessionGoalCommand } from '@/hooks/useSessionGoals'
import { getGoalRoundsLabel, getGoalStatusTitle } from '@opencode-manager/shared/notifications'
import type { GoalStatus } from '@opencode-manager/shared/opencode'

const STATUS_CHIP_CLASSES: Record<GoalStatus, string> = {
  active: 'bg-highlight text-highlight-foreground border-highlight',
  paused: 'bg-warning/15 text-warning border-warning/40',
  complete: 'bg-success/15 text-success border-success/40',
}

const GOAL_BUTTON_CLASSES = 'h-6 px-2 text-xs'

/** Renders the session's OpenCode goal with pause, resume and clear controls. */
export function SessionGoalBar({ sessionID, directory }: { sessionID: string; directory: string | undefined }) {
  const { data } = useSessionGoal(sessionID, directory)
  const goalCommand = useSessionGoalCommand(directory)
  const [expanded, setExpanded] = useState(false)

  if (!data || !data.supported || data.goal === null) return null

  const goal = data.goal
  const open = goal.status !== 'complete'

  return (
    <div className="mb-1 flex flex-col gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`gap-1 px-2 py-0.5 font-medium ${STATUS_CHIP_CLASSES[goal.status]}`}
        >
          <Target className="h-3 w-3" />
          {getGoalStatusTitle(goal.status)}
        </Badge>

        {goal.status === 'active' && (
          <span className="text-muted-foreground">{getGoalRoundsLabel(goal)}</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {goal.status === 'active' && (
            <Button
              variant="ghost"
              size="sm"
              className={GOAL_BUTTON_CLASSES}
              disabled={goalCommand.isPending}
              onClick={() => goalCommand.mutate({ sessionID, text: 'pause' })}
            >
              Pause
            </Button>
          )}
          {goal.status === 'paused' && (
            <Button
              variant="ghost"
              size="sm"
              className={GOAL_BUTTON_CLASSES}
              disabled={goalCommand.isPending}
              onClick={() => goalCommand.mutate({ sessionID, text: 'resume' })}
            >
              Resume
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={`${GOAL_BUTTON_CLASSES} text-destructive hover:text-destructive`}
            disabled={goalCommand.isPending}
            onClick={() => goalCommand.mutate({ sessionID, text: 'clear' })}
          >
            Clear
          </Button>
        </div>
      </div>

      {open && (
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

      {goal.reason && (
        <p className="truncate text-muted-foreground" title={goal.reason}>
          {goal.reason}
        </p>
      )}
    </div>
  )
}
