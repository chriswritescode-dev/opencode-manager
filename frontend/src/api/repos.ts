import type { Repo } from './types'
import { API_BASE_URL } from '@/config'
import { authFetch } from '@/lib/auth'

export async function createRepo(
  repoUrl?: string,
  localPath?: string,
  branch?: string,
  openCodeConfigName?: string,
  useWorktree?: boolean
): Promise<Repo> {
  const response = await authFetch(`${API_BASE_URL}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl, localPath, branch, openCodeConfigName, useWorktree }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create repo')
  }

  return response.json()
}

export async function listRepos(): Promise<Repo[]> {
  const response = await authFetch(`${API_BASE_URL}/api/repos`)

  if (!response.ok) {
    throw new Error('Failed to list repos')
  }

  return response.json()
}

export async function getRepo(id: number): Promise<Repo> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}`)

  if (!response.ok) {
    throw new Error('Failed to get repo')
  }

  return response.json()
}

export async function deleteRepo(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error('Failed to delete repo')
  }
}

export async function startServer(id: number, openCodeConfigName?: string): Promise<Repo> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/server/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openCodeConfigName }),
  })

  if (!response.ok) {
    throw new Error('Failed to start server')
  }

  return response.json()
}

export async function stopServer(id: number): Promise<Repo> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/server/stop`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error('Failed to stop server')
  }

  return response.json()
}

export async function pullRepo(id: number): Promise<Repo> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/pull`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error('Failed to pull repo')
  }

  return response.json()
}

export async function getServerLogs(id: number): Promise<string> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/server/logs`)

  if (!response.ok) {
    throw new Error('Failed to get server logs')
  }

  return response.text()
}

export async function switchRepoConfig(id: number, configName: string): Promise<Repo> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/config/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configName }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to switch config')
  }

  return response.json()
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
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/branch/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  })

  if (!response.ok) {
    const error = await response.json()
    if (error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.error || 'Git authentication failed', error.code)
    }
    throw new Error(error.error || 'Failed to switch branch')
  }

  return response.json()
}

export async function listBranches(id: number): Promise<{ local: string[], all: string[], current: string | null }> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/branches`)

  if (!response.ok) {
    throw new Error('Failed to list branches')
  }

  return response.json()
}

export async function createBranch(id: number, branch: string): Promise<Repo> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/branch/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  })

  if (!response.ok) {
    const error = await response.json()
    if (error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.error || 'Git authentication failed', error.code)
    }
    throw new Error(error.error || 'Failed to create branch')
  }

  return response.json()
}

export async function downloadRepo(id: number, repoName: string): Promise<void> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${id}/download`)

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to download repo')
  }

  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${repoName}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}
