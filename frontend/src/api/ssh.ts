import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

export function respondSSHHostKey(requestId: string, approved: boolean): Promise<{ success: boolean; error?: string }> {
  return fetchWrapper(`${API_BASE_URL}/api/ssh/host-key/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, response: approved ? 'accept' : 'reject' }),
  })
}

export function getSSHHostKeyStatus(): Promise<{ success: boolean; pendingCount?: number; error?: string }> {
  return fetchWrapper(`${API_BASE_URL}/api/ssh/host-key/status`)
}
