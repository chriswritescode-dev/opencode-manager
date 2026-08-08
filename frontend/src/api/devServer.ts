import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { DevServerState } from '@opencode-manager/shared/types'

export async function getDevServerStatus(repoId: number): Promise<DevServerState> {
  return fetchWrapper(`${API_BASE_URL}/api/dev-server/${repoId}/status`)
}
