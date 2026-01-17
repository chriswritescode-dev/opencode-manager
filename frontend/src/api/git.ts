import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config'
import type { GitStatusResponse, FileDiffResponse, GitCommit } from '@/types/git'

export class GitError extends Error {
  code?: string
  statusCode?: number

  constructor(message: string, code?: string, statusCode?: number) {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.statusCode = statusCode
  }
}

interface ApiError {
  error: string
  code?: string
}

async function handleApiError(response: Response): Promise<never> {
  const data: ApiError = await response.json().catch(() => ({ error: 'An error occurred' }))
  throw new GitError(data.error, data.code, response.status)
}

export async function fetchGitStatus(repoId: number): Promise<GitStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/status`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch git status' }))
    throw new Error(error.error || 'Failed to fetch git status')
  }

  return response.json()
}

export async function fetchReposGitStatus(repoIds: number[]): Promise<Map<number, GitStatusResponse>> {
  const response = await fetch(`${API_BASE_URL}/api/repos/git-status-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoIds })
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch batch git status' }))
    throw new Error(error.error || 'Failed to fetch batch git status')
  }

  const data = await response.json()
  return new Map(Object.entries(data).map(([id, status]) => [Number(id), status as GitStatusResponse]))
}

export async function fetchFileDiff(repoId: number, path: string): Promise<FileDiffResponse> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/diff?path=${encodeURIComponent(path)}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch file diff' }))
    throw new Error(error.error || 'Failed to fetch file diff')
  }

  return response.json()
}

export async function fetchGitLog(repoId: number, limit?: number): Promise<{ commits: GitCommit[] }> {
  const params = limit ? `?limit=${limit}` : ''
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/log${params}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch git log' }))
    throw new Error(error.error || 'Failed to fetch git log')
  }

  return response.json()
}

export async function gitFetch(repoId: number): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/fetch`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch' }))
    throw new Error(error.error || 'Failed to fetch')
  }

  return response.json()
}

export async function gitPull(repoId: number): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/pull`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to pull' }))
    throw new Error(error.error || 'Failed to pull')
  }

  return response.json()
}

export async function gitPush(repoId: number): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/push`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to push' }))
    throw new Error(error.error || 'Failed to push')
  }

  return response.json()
}

export async function gitCommit(repoId: number, message: string, stagedPaths?: string[]): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, stagedPaths }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to commit' }))
    throw new Error(error.error || 'Failed to commit')
  }

  return response.json()
}

export async function gitStageFiles(repoId: number, paths: string[]): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to stage files' }))
    throw new Error(error.error || 'Failed to stage files')
  }

  return response.json()
}

export async function gitUnstageFiles(repoId: number, paths: string[]): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/unstage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to unstage files' }))
    throw new Error(error.error || 'Failed to unstage files')
  }

  return response.json()
}

export async function fetchGitDiff(repoId: number, path: string): Promise<{ diff: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/diff-full?path=${encodeURIComponent(path)}`)

  if (!response.ok) {
    await handleApiError(response)
  }

  const data = await response.json()
  return { diff: data.diff }
}

export async function fetchBranches(repoId: number): Promise<{ branches: string[]; status: { ahead: number; behind: number } }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/git/branches`)

  if (!response.ok) {
    await handleApiError(response)
  }

  return response.json()
}

export async function createBranch(repoId: number, branchName: string): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/branch/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch: branchName })
  })

  if (!response.ok) {
    await handleApiError(response)
  }

  return response.json()
}

export async function switchBranch(repoId: number, branchName: string): Promise<{ stdout: string; stderr: string }> {
  const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/branch/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch: branchName })
  })

  if (!response.ok) {
    await handleApiError(response)
  }

  return response.json()
}

export function useGitStatus(repoId: number | undefined) {
  return useQuery({
    queryKey: ['gitStatus', repoId],
    queryFn: () => repoId ? fetchGitStatus(repoId) : Promise.reject(new Error('No repo ID')),
    enabled: !!repoId,
    refetchInterval: 10000,
  })
}

export function useFileDiff(repoId: number | undefined, path: string | undefined) {
  return useQuery({
    queryKey: ['fileDiff', repoId, path],
    queryFn: () => (repoId && path) ? fetchFileDiff(repoId, path) : Promise.reject(new Error('Missing params')),
    enabled: !!repoId && !!path,
  })
}

export function useGitLog(repoId: number | undefined, limit?: number) {
  return useQuery({
    queryKey: ['gitLog', repoId, limit],
    queryFn: () => repoId ? fetchGitLog(repoId, limit) : Promise.reject(new Error('No repo ID')),
    enabled: !!repoId,
  })
}

export function useBranches(repoId: number | undefined) {
  return useQuery({
    queryKey: ['branches', repoId],
    queryFn: () => repoId ? fetchBranches(repoId) : Promise.reject(new Error('No repo ID')),
    enabled: !!repoId,
    staleTime: 30000,
  })
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  const err = error as { status?: number; message?: string; error?: string }
  if (err?.status === 401) return 'Authentication failed. Please update your Git token in Settings.'
  if (err?.status === 409) return 'Merge conflict detected. Please resolve conflicts first.'
  if (err?.status === 404) return 'Repository or file not found.'
  return err?.message || err?.error || String(error) || 'An error occurred'
}