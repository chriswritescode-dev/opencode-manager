import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { SessionGoal, StartSessionGoalRequest } from '@opencode-manager/shared/schemas'

export async function getLatestSessionGoal(sessionId: string): Promise<SessionGoal | null> {
  const res = await fetchWrapper<{ goal: SessionGoal | null }>(`${API_BASE_URL}/api/session-goals`, {
    params: { sessionId },
  })
  return res.goal
}

export async function startSessionGoal(input: StartSessionGoalRequest): Promise<SessionGoal> {
  const res = await fetchWrapper<{ goal: SessionGoal }>(`${API_BASE_URL}/api/session-goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return res.goal
}

async function runGoalAction(id: number, action: 'pause' | 'resume' | 'cancel'): Promise<SessionGoal> {
  const res = await fetchWrapper<{ goal: SessionGoal }>(
    `${API_BASE_URL}/api/session-goals/${encodeURIComponent(id)}/${action}`,
    { method: 'POST' },
  )
  return res.goal
}

export function pauseSessionGoal(id: number): Promise<SessionGoal> {
  return runGoalAction(id, 'pause')
}

export function resumeSessionGoal(id: number): Promise<SessionGoal> {
  return runGoalAction(id, 'resume')
}

export function cancelSessionGoal(id: number): Promise<SessionGoal> {
  return runGoalAction(id, 'cancel')
}
