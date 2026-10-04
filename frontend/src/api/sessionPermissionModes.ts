import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { SessionPermissionModeState, SetSessionPermissionModeRequest } from '@opencode-manager/shared/schemas'

export async function getSessionPermissionMode(sessionId: string): Promise<SessionPermissionModeState> {
  return fetchWrapper<SessionPermissionModeState>(
    `${API_BASE_URL}/api/session-permission-modes/${encodeURIComponent(sessionId)}`,
  )
}

export async function setSessionPermissionMode(
  sessionId: string,
  input: SetSessionPermissionModeRequest,
): Promise<SessionPermissionModeState> {
  return fetchWrapper<SessionPermissionModeState>(
    `${API_BASE_URL}/api/session-permission-modes/${encodeURIComponent(sessionId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}
