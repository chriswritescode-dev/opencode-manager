import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/constants/api'
import type { FileInfo } from '@/types/files'

const API_BASE = API_BASE_URL

async function fetchFile(path: string): Promise<FileInfo> {
  const response = await fetch(`${API_BASE}/api/files/${path}`)
  
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