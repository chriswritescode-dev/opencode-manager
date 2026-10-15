import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { SessionSandboxState, SetSessionSandboxRequest } from '@opencode-manager/shared/schemas'

export async function getSessionSandbox(sessionId: string): Promise<SessionSandboxState> {
  return fetchWrapper<SessionSandboxState>(
    `${API_BASE_URL}/api/session-sandbox/${encodeURIComponent(sessionId)}`,
  )
}

export async function setSessionSandbox(
  sessionId: string,
  input: SetSessionSandboxRequest,
): Promise<SessionSandboxState> {
  return fetchWrapper<SessionSandboxState>(
    `${API_BASE_URL}/api/session-sandbox/${encodeURIComponent(sessionId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}
