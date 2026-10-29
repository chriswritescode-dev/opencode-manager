import { isRpcError } from '@opencode/client'
import type { Goal } from '@opencode/schema/goal'
import type { OpenCodeApi } from './index'

/** The OpenCode goal as the server reports it. */
export type GoalState = Goal.State

/** The lifecycle status of an OpenCode goal. */
export type GoalStatus = Goal.State['status']

/** The RPC the `/goal` plugin exposes on the OpenCode server. */
export const GOAL_RPC_ID = 'opencode.goal'

/** The event the `/goal` plugin publishes in a session's location on every goal write. */
export const GOAL_CHANGED_EVENT_TYPE = 'rpc.opencode.goal.changed'

/** The slash command that controls a session goal. */
export const GOAL_COMMAND_NAME = 'goal'

/** Pause reasons that mean the user stopped the goal rather than the goal finishing its work. */
export const GOAL_USER_PAUSE_REASONS = ['Paused by the user', 'Stopped by the user'] as const

const GOAL_STATUSES = ['active', 'paused', 'complete'] as const satisfies readonly GoalStatus[]

/** Reports whether a value from a remote server has the shape of a reported goal. */
function isGoalState(value: unknown): value is GoalState {
  if (typeof value !== 'object' || value === null) return false
  const goal = value as { id?: unknown; objective?: unknown; status?: unknown; rounds?: unknown; maxRounds?: unknown }
  return (
    typeof goal.id === 'string' &&
    typeof goal.objective === 'string' &&
    (GOAL_STATUSES as readonly unknown[]).includes(goal.status) &&
    typeof goal.rounds === 'number' &&
    typeof goal.maxRounds === 'number'
  )
}

/** The result of reading a session goal, distinguishing an older server without the goal RPC. */
export type SessionGoalRead = { supported: true; goal: GoalState | null } | { supported: false }

/** Reads a session goal, reporting an unsupported server instead of throwing. */
export async function readSessionGoal(
  api: OpenCodeApi,
  input: { sessionID: string; directory?: string },
): Promise<SessionGoalRead> {
  try {
    const result = await api.rpc.call({
      rpcID: GOAL_RPC_ID,
      method: 'get',
      input: { sessionID: input.sessionID },
      ...(input.directory ? { location: { directory: input.directory } } : {}),
    })
    return { supported: true, goal: (result.output ?? null) as GoalState | null }
  } catch (error) {
    if (isRpcError(error) && error.type === 'rpc.unavailable') return { supported: false }
    throw error
  }
}

/** Extracts a session goal change from an OpenCode event, ignoring unrelated and malformed events. */
export function goalChangeFromEvent(
  event: { type: string; data: unknown },
): { sessionID: string; goal: GoalState | null } | null {
  if (event.type !== GOAL_CHANGED_EVENT_TYPE) return null

  const data = event.data
  if (typeof data !== 'object' || data === null) return null

  const sessionID = (data as { sessionID?: unknown }).sessionID
  if (typeof sessionID !== 'string') return null

  const goal = (data as { goal?: unknown }).goal
  if (goal === null) return { sessionID, goal: null }
  if (!isGoalState(goal)) return null

  return { sessionID, goal }
}

/** Reports whether the goal is still being worked on, whether running or paused. */
export function isGoalOpen(goal: GoalState | null | undefined): boolean {
  return goal?.status === 'active' || goal?.status === 'paused'
}

/** Reports whether the goal reached an outcome, meaning it completed or the reviewer paused it. */
export function isGoalOutcome(goal: GoalState): boolean {
  if (goal.status === 'complete') return true
  if (goal.status !== 'paused') return false
  return !(GOAL_USER_PAUSE_REASONS as readonly string[]).includes(goal.reason ?? '')
}
