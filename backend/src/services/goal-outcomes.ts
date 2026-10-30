import {
  goalChangeFromEvent,
  isGoalOutcome,
  sessionIDFromEvent,
  type GoalState,
  type GoalStatus,
} from '@opencode-manager/shared/opencode'
import type { SSEEvent } from './sse-aggregator'

/**
 * A goal outcome observed for a session, ready to be turned into a notification.
 *
 * `directory` is the working directory to attribute the outcome to, preferring the
 * observer's directory over the event location.
 */
export interface SessionGoalOutcome {
  serverId: string
  sessionId: string
  directory: string | null
  goal: GoalState
}

/**
 * Tracks the last goal state seen per session so each goal outcome is reported once.
 *
 * State is in-memory only and keyed by server and session separated by a NUL
 * character, which cannot appear in either id. Nothing is persisted or written to
 * the database, so a fresh tracker reports the first outcome it sees.
 */
export class GoalOutcomeTracker {
  private readonly observed = new Map<string, { id: string; status: GoalStatus }>()

  /**
   * Records a goal change and returns the outcome it produces, if any.
   *
   * Returns an outcome only when the goal reached a terminal state and that exact
   * goal id and status were not already seen for the session. A deleted session, a
   * cleared goal, or a missing goal reports no outcome and forgets the stored state.
   */
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
