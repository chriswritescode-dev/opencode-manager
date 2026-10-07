import { SessionGoalVerdictSchema, type SessionGoalVerdict } from '@opencode-manager/shared/schemas'
import { extractFirstJsonObject } from '../utils/json-extract'
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

export function parseGoalVerdict(text: string): GoalVerdict | null {
  const block = extractFirstJsonObject(text)
  if (!block) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(block)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const candidate = parsed as { verdict?: unknown; reason?: unknown }
  const verdict = SessionGoalVerdictSchema.safeParse(candidate.verdict)
  if (!verdict.success) {
    return null
  }

  if (typeof candidate.reason !== 'string') {
    return null
  }

  const reason = candidate.reason.trim()
  if (!reason) {
    return null
  }

  return { verdict: verdict.data, reason: reason.slice(0, GOAL_AUDIT_REASON_MAX_CHARS) }
}

function truncateReply(reply: string | null): string {
  if (!reply) {
    return '(no reply yet)'
  }
  return truncateSessionReply(reply)
}
