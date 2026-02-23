import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'

interface SSHHostKeyResponse {
  success: boolean
  error?: string
}

export async function respondSSHHostKey(requestId: string, approved: boolean): Promise<SSHHostKeyResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/ssh/host-key/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, response: approved ? 'accept' : 'reject' }),
  })
}
