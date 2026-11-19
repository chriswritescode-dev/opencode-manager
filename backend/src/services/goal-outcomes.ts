import {
  goalChangeFromEvent,
  isGoalOutcome,
  sessionIDFromEvent,
  type GoalState,
  type GoalStatus,
} from '@opencode-manager/shared/opencode'
import type { SSEEvent } from './sse-aggregator'

export interface SessionGoalOutcome {
  serverId: string
  sessionId: string
  directory: string | null
  goal: GoalState
}

export class GoalOutcomeTracker {
  private readonly observed = new Map<string, { id: string; status: GoalStatus }>()

  observe(serverId: string, directory: string | null, event: SSEEvent): SessionGoalOutcome | null {
    if (event.type === 'session.deleted') {
      const sessionId = sessionIDFromEvent(event)
      if (sessionId) {
        this.observed.delete(this.key(serverId, sessionId))
      }
      return null
    }

    const change = goalChangeFromEvent(event)
    if (!change) return null

    const key = this.key(serverId, change.sessionID)
    if (change.goal === null) {
      this.observed.delete(key)
      return null
    }

    const goal = change.goal
    const previous = this.observed.get(key)
    this.observed.set(key, { id: goal.id, status: goal.status })

    if (!isGoalOutcome(goal)) return null
    if (previous?.id === goal.id && previous.status === goal.status) return null

    return {
      serverId,
      sessionId: change.sessionID,
      directory: directory ?? event.location?.directory ?? null,
      goal,
    }
  }

  private key(serverId: string, sessionID: string): string {
    return `${serverId}\u0000${sessionID}`
  }
}
