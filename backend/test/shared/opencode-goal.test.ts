import { describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '@opencode-manager/shared/utils'
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
import type { GoalState, GoalStatus, OpenCodeApi, SessionGoalRpc } from '@opencode-manager/shared/opencode'

const SESSION_ID = 'ses_goal_1'

const goalFixture = {
  id: 'goal_1',
  objective: 'Ship the shared goal module',
  status: 'active',
  rounds: 0,
  maxRounds: 50,
  boot: 'boot_1',
  updatedAt: 1_700_000_000_000,
} satisfies GoalState

const baseGoal: GoalState = goalFixture

function goalState(status: GoalStatus, overrides: Partial<GoalState> = {}): GoalState {
  return { ...baseGoal, status, ...overrides }
}

function goalPayload(overrides: Record<string, JsonValue>) {
  return { ...goalFixture, ...overrides }
}

function goalWithout(key: string) {
  return Object.fromEntries(Object.entries(goalFixture).filter(([name]) => name !== key))
}

function createApi(call: OpenCodeApi['rpc']['call']): SessionGoalRpc {
  return { rpc: { call } }
}

function rpcError(type: string, message: string) {
  return { _tag: 'RpcError' as const, type, message }
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
  it('sends the goal get rpc scoped to the session location', async () => {
    const call = vi.fn<OpenCodeApi['rpc']['call']>().mockResolvedValue({ output: baseGoal })

    await readSessionGoal(createApi(call), { sessionID: SESSION_ID, directory: '/repo' })

    expect(call).toHaveBeenCalledWith({
      rpcID: 'opencode.goal',
      method: 'get',
      input: { sessionID: SESSION_ID },
      location: { directory: '/repo' },
    })
  })

  it('omits the location when no directory is provided', async () => {
    const call = vi.fn<OpenCodeApi['rpc']['call']>().mockResolvedValue({ output: baseGoal })

    await readSessionGoal(createApi(call), { sessionID: SESSION_ID })

    expect(call).toHaveBeenCalledWith({
      rpcID: 'opencode.goal',
      method: 'get',
      input: { sessionID: SESSION_ID },
    })
    expect(call.mock.calls[0]?.[0]).not.toHaveProperty('location')
  })

  it('returns the goal reported by the server', async () => {
    const call = vi.fn<OpenCodeApi['rpc']['call']>().mockResolvedValue({ output: baseGoal })

    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).resolves.toEqual({
      supported: true,
      goal: baseGoal,
    })
  })

  it('returns a null goal when the session has none', async () => {
    const call = vi.fn<OpenCodeApi['rpc']['call']>().mockResolvedValue({})

    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).resolves.toEqual({
      supported: true,
      goal: null,
    })
  })

  it.each([
    ['an unknown status', goalPayload({ status: 'bogus' })],
    ['a missing objective', goalWithout('objective')],
    ['a non-object output', 'not a goal'],
  ])('reports a goal with %s as unsupported', async (_label, output) => {
    const call = vi.fn<OpenCodeApi['rpc']['call']>().mockResolvedValue({ output })

    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).resolves.toEqual({ supported: false })
  })

  it('reports an unavailable rpc as unsupported', async () => {
    const call = vi
      .fn<OpenCodeApi['rpc']['call']>()
      .mockRejectedValue(rpcError('rpc.unavailable', 'RPC is unavailable: opencode.goal'))

    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).resolves.toEqual({ supported: false })
  })

  it('rethrows every other error unchanged', async () => {
    const error = rpcError('rpc.failed', 'boom')
    const call = vi.fn<OpenCodeApi['rpc']['call']>().mockRejectedValue(error)

    await expect(readSessionGoal(createApi(call), { sessionID: SESSION_ID })).rejects.toBe(error)
  })
})

describe('goalChangeFromEvent', () => {
  it('accepts the goal changed event with a goal', () => {
    expect(
      goalChangeFromEvent({ type: GOAL_CHANGED_EVENT_TYPE, data: { sessionID: SESSION_ID, goal: baseGoal } }),
    ).toEqual({ sessionID: SESSION_ID, goal: baseGoal })
  })

  it('accepts the goal changed event with a cleared goal', () => {
    expect(
      goalChangeFromEvent({ type: GOAL_CHANGED_EVENT_TYPE, data: { sessionID: SESSION_ID, goal: null } }),
    ).toEqual({ sessionID: SESSION_ID, goal: null })
  })

  it('ignores other event types', () => {
    expect(goalChangeFromEvent({ type: 'session.idle', data: { sessionID: SESSION_ID, goal: baseGoal } })).toBeNull()
  })

  it.each([
    ['null data', null],
    ['a missing session id', { goal: baseGoal }],
    ['a non-string session id', { sessionID: 42, goal: baseGoal }],
    ['a missing goal', { sessionID: SESSION_ID }],
    ['a non-object goal', { sessionID: SESSION_ID, goal: 'active' }],
    ['a goal without a status', { sessionID: SESSION_ID, goal: { objective: 'no status' } }],
    ['a goal with an unknown status', { sessionID: SESSION_ID, goal: goalPayload({ status: 'stopped' }) }],
    ['a goal without an objective', { sessionID: SESSION_ID, goal: goalWithout('objective') }],
    ['a goal without an id', { sessionID: SESSION_ID, goal: goalWithout('id') }],
    ['a goal with a string rounds value', { sessionID: SESSION_ID, goal: goalPayload({ rounds: '0' }) }],
    ['a goal with a null maxRounds', { sessionID: SESSION_ID, goal: goalPayload({ maxRounds: null }) }],
  ])('ignores malformed data: %s', (_label, data) => {
    expect(goalChangeFromEvent({ type: GOAL_CHANGED_EVENT_TYPE, data })).toBeNull()
  })
})

describe('isGoalOpen', () => {
  it('is true for active and paused goals', () => {
    expect(isGoalOpen(goalState('active'))).toBe(true)
    expect(isGoalOpen(goalState('paused'))).toBe(true)
  })

  it('is false for complete, missing and undefined goals', () => {
    expect(isGoalOpen(goalState('complete'))).toBe(false)
    expect(isGoalOpen(null)).toBe(false)
    expect(isGoalOpen(undefined)).toBe(false)
  })
})

describe('isGoalOutcome', () => {
  it('is true for a complete goal', () => {
    expect(isGoalOutcome(goalState('complete'))).toBe(true)
  })

  it('is true for a paused goal that is not paused by the user', () => {
    expect(isGoalOutcome(goalState('paused', { reason: 'Reached the limit of 50 rounds' }))).toBe(true)
  })

  it.each(GOAL_USER_PAUSE_REASONS)('is false for the user pause reason %s', (reason) => {
    expect(isGoalOutcome(goalState('paused', { reason }))).toBe(false)
  })

  it('is false for an active goal', () => {
    expect(isGoalOutcome(goalState('active'))).toBe(false)
  })
})
