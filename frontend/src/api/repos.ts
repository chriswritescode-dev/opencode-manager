import type { Repo } from './types'
import { FetchError, fetchWrapper, fetchWrapperVoid, fetchWrapperBlob } from './fetchWrapper'
import { API_BASE_URL } from '@/config'

export async function createRepo(
  repoUrl?: string,
  localPath?: string,
  branch?: string,
  openCodeConfigName?: string,
  useWorktree?: boolean,
  skipSSHVerification?: boolean
): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl, localPath, branch, openCodeConfigName, useWorktree, skipSSHVerification }),
  })
}

export async function listRepos(): Promise<Repo[]> {
  return fetchWrapper(`${API_BASE_URL}/api/repos`)
}

export async function getRepo(id: number): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}`)
}

export async function deleteRepo(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${id}`, {
    method: 'DELETE',
  })
}

export async function startServer(id: number, openCodeConfigName?: string): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/server/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openCodeConfigName }),
  })
}

export async function stopServer(id: number): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/server/stop`, {
    method: 'POST',
  })
}

export async function pullRepo(id: number): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/pull`, {
    method: 'POST',
  })
}

export async function switchRepoConfig(id: number, configName: string): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/config/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configName }),
  })
}

export class GitAuthError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'GitAuthError'
    this.code = code
  }
}

export async function switchBranch(id: number, branch: string): Promise<Repo> {
  try {
    return await fetchWrapper(`${API_BASE_URL}/api/repos/${id}/branch/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
  } catch (error) {
    if (error instanceof FetchError && error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.message, error.code)
    }
    throw error
  }
}

interface GitBranch {
  name: string
  type: 'local' | 'remote'
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
  isWorktree?: boolean
}

export async function listBranches(id: number): Promise<{ branches: GitBranch[], status: { ahead: number, behind: number } }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/git/branches`)
}

export async function createBranch(id: number, branch: string): Promise<Repo> {
  try {
    return await fetchWrapper(`${API_BASE_URL}/api/repos/${id}/branch/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
  } catch (error) {
    if (error instanceof FetchError && error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.message, error.code)
    }
    throw error
  }
}

export interface DownloadOptions {
  includeGit?: boolean
  includePaths?: string[]
}

export async function downloadRepo(id: number, repoName: string, options?: DownloadOptions): Promise<void> {
  const params = new URLSearchParams()
  if (options?.includeGit) params.append('includeGit', 'true')
  if (options?.includePaths?.length) params.append('includePaths', options.includePaths.join(','))

  const url = `${API_BASE_URL}/api/repos/${id}/download${params.toString() ? '?' + params.toString() : ''}`
  
  const blob = await fetchWrapperBlob(url)
  const urlObj = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = urlObj
  a.download = `${repoName}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(urlObj)
}

export async function updateRepoOrder(order: number[]): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
}

export async function resetRepoPermissions(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${id}/reset-permissions`, {
    method: 'POST',
  })
}
