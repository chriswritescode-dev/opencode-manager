import type { SessionGoal } from '@opencode-manager/shared/schemas'

export function goal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    id: 7,
    sessionId: 'ses_a',
    directory: '/repo',
    objective: 'fix it',
    status: 'active',
    stopReason: null,
    turnState: 'waiting',
    continuationCount: 0,
    maxContinuations: 5,
    tokenBudget: null,
    tokensUsed: 0,
    consecutiveBlocked: 0,
    lastVerdict: null,
    lastReason: null,
    createdAt: 1,
    updatedAt: 1,
    finishedAt: null,
    ...overrides,
  }
}
