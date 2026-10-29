import { describe, expect, it, vi } from 'vitest'
import {
  GOAL_CHANGED_EVENT_TYPE,
  GOAL_COMMAND_NAME,
  GOAL_RPC_ID,
  GOAL_USER_PAUSE_REASONS,
  goalChangeFromEvent,
  isGoalOpen,
  isGoalOutcome,
  readSessionGoal,
} from '@opencode-manager/shared/opencode'
import type { GoalState, OpenCodeApi } from '@opencode-manager/shared/opencode'

const SESSION_ID = 'ses_goal_1'

const baseGoal: GoalState = {
  id: 'goal_1',
  objective: 'Ship the shared goal module',
  status: 'active',
  rounds: 0,
  maxRounds: 50,
  boot: 'boot_1',
  updatedAt: 1_700_000_000_000,
}

function goalWith(overrides: Partial<GoalState>): GoalState {
  return { ...baseGoal, ...overrides }
}

function goalWithout(key: keyof GoalState): Record<string, unknown> {
  const goal: Record<string, unknown> = { ...baseGoal }
  delete goal[key]
  return goal
}

function createApi(call: ReturnType<typeof vi.fn>): OpenCodeApi {
  return { rpc: { call } } as unknown as OpenCodeApi
}

function rpcError(type: string, message: string): { _tag: 'RpcError'; type: string; message: string } {
  return { _tag: 'RpcError', type, message }
}

describe('goal contract constants', () => {
  it('pins the OpenCode goal rpc, event, command and user pause reasons', () => {
    expect(GOAL_RPC_ID).toBe('opencode.goal')
    expect(GOAL_CHANGED_EVENT_TYPE).toBe('rpc.opencode.goal.changed')
    expect(GOAL_COMMAND_NAME).toBe('goal')
    expect(GOAL_USER_PAUSE_REASONS).toEqual(['Paused by the user', 'Stopped by the user'])
  })
})

describe('readSessionGoal', () => {
  it('sends the exact rpc call with the session location', async () => {
    const call = vi.fn().mockResolvedValue({ output: baseGoal })
    await readSessionGoal(createApi(call), { sessionID: SESSION_ID, directory: '/repo' })

    expect(call).toHaveBeenCalledWith({
      rpcID: 'opencode.goal',
      method: 'get',
      input: { sessionID: SESSION_ID },
      location: { directory: '/repo' },
    })
  })

  it('omits the location when no directory is provided', async () => {
    const call = vi.fn().mockResolvedValue({ output: baseGoal })
    await readSessionGoal(createApi(call), { sessionID: SESSION_ID })

    expect(call).toHaveBeenCalledWith({
      rpcID: 'opencode.goal',
      method: 'get',
      input: { sessionID: SESSION_ID },
    })
    expect(call.mock.calls[0]?.[0]).not.toHaveProperty('location')
  })

  it('returns the goal reported by the server', async () => {
    const call = vi.fn().mockResolvedValue({ output: baseGoal })
    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).resolves.toEqual({
      supported: true,
      goal: baseGoal,
    })
  })

  it('returns a null goal when the session has none', async () => {
    const call = vi.fn().mockResolvedValue({})
    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).resolves.toEqual({
      supported: true,
      goal: null,
    })
  })

  it('reports an unavailable rpc as unsupported', async () => {
    const call = vi.fn().mockRejectedValue(rpcError('rpc.unavailable', 'RPC is unavailable: opencode.goal'))
    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).resolves.toEqual({ supported: false })
  })

  it('rethrows every other error unchanged', async () => {
    const error = rpcError('rpc.failed', 'boom')
    const call = vi.fn().mockRejectedValue(error)
    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).rejects.toBe(error)
  })
})

describe('goalChangeFromEvent', () => {
  it('accepts the goal changed event with a goal', () => {
    expect(goalChangeFromEvent({ type: 'rpc.opencode.goal.changed', data: { sessionID: SESSION_ID, goal: baseGoal } })).toEqual({
      sessionID: SESSION_ID,
      goal: baseGoal,
    })
  })

  it('accepts the goal changed event with a cleared goal', () => {
    expect(goalChangeFromEvent({ type: 'rpc.opencode.goal.changed', data: { sessionID: SESSION_ID, goal: null } })).toEqual({
      sessionID: SESSION_ID,
      goal: null,
    })
  })

  it('ignores other event types', () => {
    expect(goalChangeFromEvent({ type: 'session.idle', data: { sessionID: SESSION_ID, goal: baseGoal } })).toBeNull()
  })

  it('ignores malformed data', () => {
    const eventType = 'rpc.opencode.goal.changed'
    expect(goalChangeFromEvent({ type: eventType, data: null })).toBeNull()
    expect(goalChangeFromEvent({ type: eventType, data: { goal: baseGoal } })).toBeNull()
    expect(goalChangeFromEvent({ type: eventType, data: { sessionID: 42, goal: baseGoal } })).toBeNull()
    expect(goalChangeFromEvent({ type: eventType, data: { sessionID: SESSION_ID } })).toBeNull()
    expect(goalChangeFromEvent({ type: eventType, data: { sessionID: SESSION_ID, goal: 'active' } })).toBeNull()
    expect(goalChangeFromEvent({ type: eventType, data: { sessionID: SESSION_ID, goal: { objective: 'no status' } } })).toBeNull()
  })

  it('ignores a goal with a status outside the contract', () => {
    expect(
      goalChangeFromEvent({
        type: 'rpc.opencode.goal.changed',
        data: { sessionID: SESSION_ID, goal: goalWith({ status: 'stopped' as GoalState['status'] }) },
      }),
    ).toBeNull()
  })

  it('ignores a goal without an objective', () => {
    expect(
      goalChangeFromEvent({
        type: 'rpc.opencode.goal.changed',
        data: { sessionID: SESSION_ID, goal: goalWithout('objective') },
      }),
    ).toBeNull()
  })

  it('ignores a goal without an id', () => {
    expect(
      goalChangeFromEvent({
        type: 'rpc.opencode.goal.changed',
        data: { sessionID: SESSION_ID, goal: goalWithout('id') },
      }),
    ).toBeNull()
  })

  it('ignores a goal whose rounds or maxRounds are not numbers', () => {
    const eventType = 'rpc.opencode.goal.changed'
    expect(
      goalChangeFromEvent({
        type: eventType,
        data: { sessionID: SESSION_ID, goal: { ...baseGoal, rounds: '0' } },
      }),
    ).toBeNull()
    expect(
      goalChangeFromEvent({
        type: eventType,
        data: { sessionID: SESSION_ID, goal: { ...baseGoal, maxRounds: null } },
      }),
    ).toBeNull()
  })
})

describe('isGoalOpen', () => {
  it('is true for active and paused goals', () => {
    expect(isGoalOpen(goalWith({ status: 'active' }))).toBe(true)
    expect(isGoalOpen(goalWith({ status: 'paused' }))).toBe(true)
  })

  it('is false for complete, missing and undefined goals', () => {
    expect(isGoalOpen(goalWith({ status: 'complete' }))).toBe(false)
    expect(isGoalOpen(null)).toBe(false)
    expect(isGoalOpen(undefined)).toBe(false)
  })
})

describe('isGoalOutcome', () => {
  it('is true for a complete goal', () => {
    expect(isGoalOutcome(goalWith({ status: 'complete' }))).toBe(true)
  })

  it('is true for a paused goal that is not paused by the user', () => {
    expect(isGoalOutcome(goalWith({ status: 'paused', reason: 'Reached the limit of 50 rounds' }))).toBe(true)
  })

  it('is false for a goal paused by the user', () => {
    expect(isGoalOutcome(goalWith({ status: 'paused', reason: 'Paused by the user' }))).toBe(false)
    expect(isGoalOutcome(goalWith({ status: 'paused', reason: 'Stopped by the user' }))).toBe(false)
  })

  it('is false for an active goal', () => {
    expect(isGoalOutcome(goalWith({ status: 'active' }))).toBe(false)
  })
})
