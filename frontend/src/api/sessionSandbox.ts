import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import {
  SessionSandboxStateSchema,
  type SessionSandboxState,
  type SetSessionSandboxRequest,
} from '@opencode-manager/shared/schemas'

export async function getSessionSandbox(sessionId: string): Promise<SessionSandboxState> {
  return fetchWrapper(
    `${API_BASE_URL}/api/session-sandbox/${encodeURIComponent(sessionId)}`,
    SessionSandboxStateSchema,
  )
}

export async function setSessionSandbox(
  sessionId: string,
  input: SetSessionSandboxRequest,
): Promise<SessionSandboxState> {
  return fetchWrapper(
    `${API_BASE_URL}/api/session-sandbox/${encodeURIComponent(sessionId)}`,
    SessionSandboxStateSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}
