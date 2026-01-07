import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config'
import type { GitStatusResponse, FileDiffResponse } from '@/types/git'
import { authFetch } from '@/lib/auth'

export async function fetchGitStatus(repoId: number): Promise<GitStatusResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${repoId}/git/status`)
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch git status' }))
    throw new Error(error.error || 'Failed to fetch git status')
  }
  
  return response.json()
}

export async function fetchFileDiff(repoId: number, path: string): Promise<FileDiffResponse> {
  const response = await authFetch(`${API_BASE_URL}/api/repos/${repoId}/git/diff?path=${encodeURIComponent(path)}`)
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch file diff' }))
    throw new Error(error.error || 'Failed to fetch file diff')
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
