import { useQuery } from '@tanstack/react-query'
import { fetchWrapper, fetchWrapperBlob } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { FileInfo, ChunkedFileInfo, PatchOperation } from '@/types/files'

async function fetchFile(path: string): Promise<FileInfo> {
  return fetchWrapper(`${API_BASE_URL}/api/files/${path}`)
}

export function useFile(path: string | undefined) {
  return useQuery({
    queryKey: ['file', path],
    queryFn: () => path ? fetchFile(path) : Promise.reject(new Error('No file path provided')),
    enabled: !!path,
  })
}

export async function fetchFileRange(path: string, startLine: number, endLine: number): Promise<ChunkedFileInfo> {
  return fetchWrapper(`${API_BASE_URL}/api/files/${path}`, {
    params: { startLine, endLine },
  })
}

export async function applyFilePatches(path: string, patches: PatchOperation[]): Promise<{ success: boolean; totalLines: number }> {
  return fetchWrapper(`${API_BASE_URL}/api/files/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patches }),
  })
}

export async function getIgnoredPaths(path: string): Promise<{ ignoredPaths: string[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/files/${path}/ignored-paths`)
}

export interface DownloadOptions {
  includeGit?: boolean
  includePaths?: string[]
}

export async function downloadDirectoryAsZip(path: string, options?: DownloadOptions): Promise<void> {
  const params = new URLSearchParams()
  if (options?.includeGit) params.append('includeGit', 'true')
  if (options?.includePaths?.length) params.append('includePaths', options.includePaths.join(','))

  const url = `${API_BASE_URL}/api/files/${path}/download-zip${params.toString() ? '?' + params.toString() : ''}`
  
  const blob = await fetchWrapperBlob(url)
  const urlObj = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = urlObj
  const dirName = path.split('/').pop() || 'download'
  a.download = `${dirName}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(urlObj)
}
