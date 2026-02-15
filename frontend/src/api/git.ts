import { useQuery } from '@tanstack/react-query'
import { fetchWrapper, FetchError } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { GitStatusResponse, FileDiffResponse, GitCommit } from '@/types/git'

export async function fetchGitStatus(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/status`)
}

export async function fetchReposGitStatus(repoIds: number[]): Promise<Map<number, GitStatusResponse>> {
  const data = await fetchWrapper<Record<string, GitStatusResponse>>(`${API_BASE_URL}/api/repos/git-status-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoIds })
  })
  return new Map(Object.entries(data).map(([id, status]) => [Number(id), status]))
}

export async function fetchFileDiff(repoId: number, path: string, includeStaged?: boolean): Promise<FileDiffResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/diff-full`, {
    params: { path, includeStaged },
  })
}

export async function fetchGitDiff(repoId: number, path: string): Promise<{ diff: string }> {
  const data = await fetchWrapper<string>(`${API_BASE_URL}/api/repos/${repoId}/git/diff`, {
    params: { path },
  })
  return { diff: data }
}

export async function fetchGitLog(repoId: number, limit?: number): Promise<{ commits: GitCommit[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/log`, {
    params: { limit },
  })
}

export async function gitFetch(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/fetch`, {
    method: 'POST',
  })
}

export async function gitPull(repoId: number): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/pull`, {
    method: 'POST',
  })
}

export async function gitPush(repoId: number, setUpstream: boolean = false): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setUpstream }),
  })
}

export async function gitCommit(repoId: number, message: string, stagedPaths?: string[]): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, stagedPaths }),
  })
}

export async function gitStageFiles(repoId: number, paths: string[]): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export async function gitUnstageFiles(repoId: number, paths: string[]): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/unstage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export async function gitReset(repoId: number, commitHash: string): Promise<GitStatusResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/git/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitHash }),
  })
}

export function useGitStatus(repoId: number | undefined) {
  return useQuery({
    queryKey: ['gitStatus', repoId],
    queryFn: () => repoId ? fetchGitStatus(repoId) : Promise.reject(new Error('No repo ID')),
    enabled: !!repoId,
    refetchInterval: false,
  })
}

export function useFileDiff(repoId: number | undefined, path: string | undefined, includeStaged?: boolean) {
  return useQuery({
    queryKey: ['fileDiff', repoId, path, includeStaged],
    queryFn: () => (repoId && path) ? fetchFileDiff(repoId, path, includeStaged) : Promise.reject(new Error('Missing params')),
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

function parseGitErrorMessage(message: string): string {
  if (message.includes('no upstream') || message.includes('does not have any commits yet')) {
    return 'No upstream branch configured. Push with --set-upstream or create commits first.'
  }
  if (message.includes('non-fast-forward') || message.includes('rejected')) {
    return 'Push rejected. Pull changes first, then push again.'
  }
  if (message.includes('CONFLICT') || message.includes('Merge conflict')) {
    return 'Merge conflict detected. Resolve conflicts before continuing.'
  }
  if (message.includes('Authentication failed') || message.includes('could not read Username')) {
    return 'Git authentication failed. Check your credentials in Settings.'
  }
  if (message.includes('Permission denied')) {
    return 'Permission denied. Check your repository access.'
  }
  if (message.includes('not a git repository')) {
    return 'Not a valid Git repository.'
  }
  return message
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof FetchError) {
    if (error.code === 'AUTH_FAILED') {
      return 'Git authentication failed. Check your credentials in Settings.'
    }
    if (error.code === 'CONFLICT') {
      return 'Merge conflict detected. Resolve conflicts before continuing.'
    }
    if (error.code === 'NOT_FOUND') {
      return 'Repository or file not found.'
    }
    if (error.statusCode === 401) return 'Git authentication failed. Check your credentials in Settings.'
    if (error.statusCode === 409) return 'Merge conflict detected. Resolve conflicts before continuing.'
    if (error.statusCode === 404) return 'Repository or file not found.'
    return parseGitErrorMessage(error.message)
  }
  if (error instanceof Error) {
    return parseGitErrorMessage(error.message)
  }
  if (typeof error === 'string') {
    return parseGitErrorMessage(error)
  }
  const err = error as { status?: number; message?: string; error?: string }
  const message = err?.message || err?.error || String(error) || 'An error occurred'
  return parseGitErrorMessage(message)
}
