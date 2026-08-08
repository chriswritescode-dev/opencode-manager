import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { BrowseDirectoryResponse } from '@opencode-manager/shared/types'

export async function browseDirectory(path?: string): Promise<BrowseDirectoryResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/filesystem/browse`, {
    params: { path },
  })
}
