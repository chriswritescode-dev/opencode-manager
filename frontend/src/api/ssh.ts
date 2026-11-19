import { z } from 'zod'
import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'

const sshHostKeyResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
})

type SSHHostKeyResponse = z.infer<typeof sshHostKeyResponseSchema>

export async function respondSSHHostKey(requestId: string, approved: boolean): Promise<SSHHostKeyResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/ssh/host-key/respond`, sshHostKeyResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, response: approved ? 'accept' : 'reject' }),
  })
}
