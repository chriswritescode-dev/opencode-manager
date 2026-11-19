import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import {
  LOCAL_OPENCODE_SERVER_ID,
  SessionPermissionModeStateSchema,
  type SessionPermissionModeState,
  type SetSessionPermissionModeRequest,
} from '@opencode-manager/shared/schemas'

export async function getSessionPermissionMode(
  sessionId: string,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): Promise<SessionPermissionModeState> {
  return fetchWrapper(
    `${API_BASE_URL}/api/session-permission-modes/${encodeURIComponent(sessionId)}`,
    SessionPermissionModeStateSchema,
    { params: { serverId } },
  )
}

export async function setSessionPermissionMode(
  sessionId: string,
  input: SetSessionPermissionModeRequest,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): Promise<SessionPermissionModeState> {
  return fetchWrapper(
    `${API_BASE_URL}/api/session-permission-modes/${encodeURIComponent(sessionId)}`,
    SessionPermissionModeStateSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, serverId }),
    },
  )
}
