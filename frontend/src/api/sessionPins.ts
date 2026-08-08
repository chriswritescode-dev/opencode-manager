import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { SessionPin, ToggleSessionPinRequest } from '@opencode-manager/shared/schemas'

export async function listSessionPins(): Promise<SessionPin[]> {
  const res = await fetchWrapper<{ pins: SessionPin[] }>(`${API_BASE_URL}/api/session-pins`)
  return res.pins
}

export async function toggleSessionPin(input: ToggleSessionPinRequest): Promise<SessionPin[]> {
  const res = await fetchWrapper<{ pins: SessionPin[] }>(`${API_BASE_URL}/api/session-pins`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return res.pins
}
