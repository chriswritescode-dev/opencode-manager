import { describe, it, expect } from 'vitest'
import {
  GOAL_CHANGED_EVENT_TYPE,
  type GoalState,
} from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { GoalOutcomeTracker, type SessionGoalOutcome } from '../../src/services/goal-outcomes'
import type { SSEEvent } from '../../src/services/sse-aggregator'

const SESSION_ID = 'ses_goal'
const EVENT_DIRECTORY = '/abs/repo'
const SERVER_ID = LOCAL_OPENCODE_SERVER_ID

function goal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: 'goal_1',
    objective: 'Ship it',
    status: 'active',
    rounds: 0,
    maxRounds: 5,
    boot: 'boot_1',
    updatedAt: 1,
    ...overrides,
  }
}

function goalEvent(sessionID: string, goalState: GoalState | null): SSEEvent {
  return {
    id: 'evt_goal',
    created: 1700000000000,
    type: GOAL_CHANGED_EVENT_TYPE,
    location: { directory: EVENT_DIRECTORY },
    data: { sessionID, goal: goalState },
  } as SSEEvent
}

function sessionDeletedEvent(sessionID: string): SSEEvent {
  return {
    id: 'evt_deleted',
    created: 1700000000000,
    type: 'session.deleted',
    data: { sessionID },
  } as SSEEvent
}

describe('GoalOutcomeTracker', () => {
  it('reports one outcome when an active goal completes', () => {
    const tracker = new GoalOutcomeTracker()

    expect(tracker.observe(SERVER_ID, '/work/repo', goalEvent(SESSION_ID, goal()))).toBeNull()

    const outcome: SessionGoalOutcome | null = tracker.observe(
      SERVER_ID,
      '/work/repo',
      goalEvent(SESSION_ID, goal({ status: 'complete' })),
    )

    expect(outcome).toEqual({
      serverId: SERVER_ID,
      sessionId: SESSION_ID,
      directory: '/work/repo',
      goal: goal({ status: 'complete' }),
    })
  })

  it('does not report the same completed goal twice', () => {
    const tracker = new GoalOutcomeTracker()
    const completed = goalEvent(SESSION_ID, goal({ status: 'complete' }))
    tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal()))

    expect(tracker.observe(SERVER_ID, null, completed)).not.toBeNull()

    expect(tracker.observe(SERVER_ID, null, completed)).toBeNull()
  })

  it('reports no outcome for a goal the user paused or stopped', () => {
    const tracker = new GoalOutcomeTracker()

    expect(
      tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'paused', reason: 'Paused by the user' }))),
    ).toBeNull()

    expect(
      tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'paused', reason: 'Stopped by the user' }))),
    ).toBeNull()
  })

  it('reports an outcome for a goal the server paused', () => {
    const tracker = new GoalOutcomeTracker()
    tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal()))

    const outcome = tracker.observe(
      SERVER_ID,
      null,
      goalEvent(SESSION_ID, goal({ status: 'paused', reason: 'The server restarted while the goal was active' })),
    )

    expect(outcome?.goal.status).toBe('paused')
    expect(outcome?.goal.reason).toBe('The server restarted while the goal was active')
  })

  it('reports an outcome for a completed goal seen for the first time', () => {
    const tracker = new GoalOutcomeTracker()

    const outcome = tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'complete' })))

    expect(outcome?.goal.id).toBe('goal_1')
    expect(outcome?.goal.status).toBe('complete')
  })

  it('reports a different goal that completes after the goal is cleared', () => {
    const tracker = new GoalOutcomeTracker()
    tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'complete' })))

    expect(tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, null))).toBeNull()

    const outcome = tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ id: 'goal_2', status: 'complete' })))

    expect(outcome?.goal.id).toBe('goal_2')
  })

  it('reports the same goal again after the goal is cleared', () => {
    const tracker = new GoalOutcomeTracker()
    tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'complete' })))
    tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, null))

    const outcome = tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'complete' })))

    expect(outcome?.goal.id).toBe('goal_1')
  })

  it('reports the same goal again after the session is deleted', () => {
    const tracker = new GoalOutcomeTracker()
    tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'complete' })))

    expect(tracker.observe(SERVER_ID, null, sessionDeletedEvent(SESSION_ID))).toBeNull()

    const outcome = tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'complete' })))

    expect(outcome?.goal.id).toBe('goal_1')
  })

  it('tracks the same session separately on each server', () => {
    const tracker = new GoalOutcomeTracker()

    tracker.observe('server_a', null, goalEvent(SESSION_ID, goal()))
    tracker.observe('server_b', null, goalEvent(SESSION_ID, goal()))

    const outcomeA = tracker.observe('server_a', null, goalEvent(SESSION_ID, goal({ status: 'complete' })))
    const outcomeB = tracker.observe('server_b', null, goalEvent(SESSION_ID, goal({ status: 'complete' })))

    expect(outcomeA?.serverId).toBe('server_a')
    expect(outcomeB?.serverId).toBe('server_b')
  })

  it('ignores non-goal events and goal changes without a session id', () => {
    const tracker = new GoalOutcomeTracker()
    const idleEvent = {
      id: 'evt_idle',
      created: 1700000000000,
      type: 'session.idle',
      data: { sessionID: SESSION_ID },
    } as SSEEvent
    const missingSessionId = {
      id: 'evt_goal',
      created: 1700000000000,
      type: GOAL_CHANGED_EVENT_TYPE,
      location: { directory: EVENT_DIRECTORY },
      data: { goal: goal({ status: 'complete' }) },
    } as SSEEvent

    expect(tracker.observe(SERVER_ID, null, idleEvent)).toBeNull()
    expect(tracker.observe(SERVER_ID, null, missingSessionId)).toBeNull()
  })

  it('falls back to the event location when no directory is passed', () => {
    const tracker = new GoalOutcomeTracker()

    const outcome = tracker.observe(SERVER_ID, null, goalEvent(SESSION_ID, goal({ status: 'complete' })))

    expect(outcome?.directory).toBe(EVENT_DIRECTORY)
  })
})
