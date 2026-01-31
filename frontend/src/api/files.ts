import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config'
import type { FileInfo, ChunkedFileInfo, PatchOperation } from '@/types/files'

async function fetchFile(path: string): Promise<FileInfo> {
  const response = await fetch(`${API_BASE_URL}/api/files/${path}`)
  
  if (!response.ok) {
    throw new Error(`Failed to load file: ${response.statusText}`)
  }
  
  return response.json()
}

export function useFile(path: string | undefined) {
  return useQuery({
    queryKey: ['file', path],
    queryFn: () => path ? fetchFile(path) : Promise.reject(new Error('No file path provided')),
    enabled: !!path,
  })
}

export async function fetchFileRange(path: string, startLine: number, endLine: number): Promise<ChunkedFileInfo> {
  const response = await fetch(`${API_BASE_URL}/api/files/${path}?startLine=${startLine}&endLine=${endLine}`)
  
  if (!response.ok) {
    throw new Error(`Failed to load file range: ${response.statusText}`)
  }
  
  return response.json()
}

export async function applyFilePatches(path: string, patches: PatchOperation[]): Promise<{ success: boolean; totalLines: number }> {
  const response = await fetch(`${API_BASE_URL}/api/files/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patches }),
  })
  
  if (!response.ok) {
    throw new Error(`Failed to apply patches: ${response.statusText}`)
  }
  
  return response.json()
}

export async function getIgnoredPaths(path: string): Promise<{ ignoredPaths: string[] }> {
  const response = await fetch(`${API_BASE_URL}/api/files/${path}/ignored-paths`)

  if (!response.ok) {
    throw new Error('Failed to get ignored paths')
  }

  return response.json()
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
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to download directory')
  }

  const blob = await response.blob()
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