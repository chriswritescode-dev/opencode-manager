import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { z } from 'zod'
import { SessionPinSchema, type SessionPin, type ToggleSessionPinRequest } from '@opencode-manager/shared/schemas'

const sessionPinsResponseSchema = z.object({ pins: z.array(SessionPinSchema) })

export async function listSessionPins(): Promise<SessionPin[]> {
  const res = await fetchWrapper(`${API_BASE_URL}/api/session-pins`, sessionPinsResponseSchema)
  return res.pins
}

export async function toggleSessionPin(input: ToggleSessionPinRequest): Promise<SessionPin[]> {
  const res = await fetchWrapper(`${API_BASE_URL}/api/session-pins`, sessionPinsResponseSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return res.pins
}
