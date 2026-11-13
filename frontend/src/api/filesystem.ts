import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { BrowseDirectoryResponseSchema } from '@opencode-manager/shared/schemas'
import type { BrowseDirectoryResponse } from '@opencode-manager/shared/types'

export async function browseDirectory(path?: string): Promise<BrowseDirectoryResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/filesystem/browse`, BrowseDirectoryResponseSchema, {
    params: { path },
  })
}
