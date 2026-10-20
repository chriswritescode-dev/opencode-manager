import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import {
  LOCAL_OPENCODE_SERVER_ID,
  type SessionPermissionModeState,
  type SetSessionPermissionModeRequest,
} from '@opencode-manager/shared/schemas'

export async function getSessionPermissionMode(
  sessionId: string,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): Promise<SessionPermissionModeState> {
  return fetchWrapper<SessionPermissionModeState>(
    `${API_BASE_URL}/api/session-permission-modes/${encodeURIComponent(sessionId)}`,
    { params: { serverId } },
  )
}

export async function setSessionPermissionMode(
  sessionId: string,
  input: SetSessionPermissionModeRequest,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): Promise<SessionPermissionModeState> {
  return fetchWrapper<SessionPermissionModeState>(
    `${API_BASE_URL}/api/session-permission-modes/${encodeURIComponent(sessionId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, serverId }),
    },
  )
}
