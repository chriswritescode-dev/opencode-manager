import { z } from 'zod'
import { SessionGoalVerdictSchema, type SessionGoalVerdict } from '@opencode-manager/shared/schemas'
import { parseFirstJsonObject } from '../utils/json-extract'
import { truncateSessionReply } from './session-reply'

export const GOAL_AUDIT_REASON_MAX_CHARS = 500
export const GOAL_AUDIT_UNPARSED_REASON = 'Auditor response was not understood'

export interface GoalAuditPromptInput {
  objective: string
  reply: string | null
}

export interface GoalContinuationPromptInput {
  objective: string
  reason: string
}

export interface GoalVerdict {
  verdict: SessionGoalVerdict
  reason: string
}

export function buildGoalAuditPrompt({ objective, reply }: GoalAuditPromptInput): string {
  return [
    'You audit whether an autonomous coding goal has been achieved.',
    'You can only see the goal objective and the agent\'s latest reply. You cannot run tools or read files.',
    '',
    'Goal objective:',
    objective,
    '',
    'Agent\'s latest reply:',
    truncateReply(reply),
    '',
    'Decide the goal state:',
    '- "done": the objective is verifiably achieved based on the reply.',
    '- "blocked": the agent needs a user decision or access it cannot obtain.',
    '- "continue": anything else, including when the reply is not enough to confirm completion.',
    '',
    'Respond with only this JSON and nothing else:',
    '{"verdict":"continue"|"done"|"blocked","reason":"<one sentence>"}',
  ].join('\n')
}

export function buildGoalContinuationPrompt({ objective, reason }: GoalContinuationPromptInput): string {
  return [
    `Continue working toward this goal: ${objective}`,
    '',
    `Progress check: ${reason}`,
    '',
    'Keep working until the goal is achieved. If you need a user decision or access you cannot obtain, stop and state exactly what you need.',
  ].join('\n')
}

const goalVerdictSchema = z.object({
  verdict: SessionGoalVerdictSchema,
  reason: z.string(),
})

export function parseGoalVerdict(text: string): GoalVerdict | null {
  const parsed = parseFirstJsonObject(text, goalVerdictSchema)
  if (!parsed) {
    return null
  }

  const reason = parsed.reason.trim()
  if (!reason) {
    return null
  }

  return { verdict: parsed.verdict, reason: reason.slice(0, GOAL_AUDIT_REASON_MAX_CHARS) }
}

function truncateReply(reply: string | null): string {
  if (!reply) {
    return '(no reply yet)'
  }
  return truncateSessionReply(reply)
}
