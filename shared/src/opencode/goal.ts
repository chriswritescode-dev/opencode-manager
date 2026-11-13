import { isRpcError } from '@opencode/client'
import type { Goal } from '@opencode/schema/goal'
import { z } from 'zod'
import type { OpenCodeApi } from './index'

export type GoalState = Goal.State

export type GoalStatus = Goal.State['status']

export const GOAL_RPC_ID = 'opencode.goal'

export const GOAL_CHANGED_EVENT_TYPE = 'rpc.opencode.goal.changed'

export const GOAL_COMMAND_NAME = 'goal'

export const GOAL_USER_PAUSE_REASONS = ['Paused by the user', 'Stopped by the user'] as const

const GOAL_USER_PAUSE_REASON_SET: ReadonlySet<string> = new Set(GOAL_USER_PAUSE_REASONS)

const GOAL_STATUSES = ['active', 'paused', 'complete'] as const satisfies readonly GoalStatus[]

const GoalStateSchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: z.enum(GOAL_STATUSES),
  reason: z.string().optional(),
  rounds: z.number(),
  maxRounds: z.number(),
  stalls: z.number().optional(),
  boot: z.string(),
  updatedAt: z.number(),
})

const GoalChangedEventSchema = z.object({
  sessionID: z.string(),
  goal: GoalStateSchema.nullable(),
})

export type SessionGoalRead = { supported: true; goal: GoalState | null } | { supported: false }

export type SessionGoalRpc = { rpc: Pick<OpenCodeApi['rpc'], 'call'> }

export async function readSessionGoal(
  api: SessionGoalRpc,
  input: { sessionID: string; directory?: string },
): Promise<SessionGoalRead> {
  try {
    const location = input.directory ? { location: { directory: input.directory } } : undefined
    const result = await api.rpc.call({
      rpcID: GOAL_RPC_ID,
      method: 'get',
      input: { sessionID: input.sessionID },
      ...location,
    })
    const output: unknown = result.output ?? null
    if (output === null) return { supported: true, goal: null }
    const goal = GoalStateSchema.safeParse(output)
    if (!goal.success) return { supported: false }
    return { supported: true, goal: goal.data }
  } catch (error) {
    if (isRpcError(error) && error.type === 'rpc.unavailable') return { supported: false }
    throw error
  }
}

export function goalChangeFromEvent(
  event: { type: string; data: unknown },
): { sessionID: string; goal: GoalState | null } | null {
  if (event.type !== GOAL_CHANGED_EVENT_TYPE) return null

  const change = GoalChangedEventSchema.safeParse(event.data)
  if (!change.success) return null

  return { sessionID: change.data.sessionID, goal: change.data.goal }
}

export function isGoalOpen(goal: GoalState | null | undefined): boolean {
  return goal?.status === 'active' || goal?.status === 'paused'
}

export function isGoalOutcome(goal: GoalState): boolean {
  if (goal.status === 'complete') return true
  if (goal.status !== 'paused') return false
  return !GOAL_USER_PAUSE_REASON_SET.has(goal.reason ?? '')
}
