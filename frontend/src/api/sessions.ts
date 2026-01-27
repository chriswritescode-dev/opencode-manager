import { API_BASE_URL } from '@/config'

export interface RecentSession {
  id: string
  title: string
  directory: string
  repoId?: number
  repoName?: string
  status?: 'idle' | 'busy' | 'retry'
  summary?: string
  time: {
    created: number
    updated: number
  }
}

export interface RecentSessionsResponse {
  sessions: RecentSession[]
  cutoffTime: number
  count: number
}

export async function getRecentSessions(hours: number = 8): Promise<RecentSessionsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/sessions/recent?hours=${hours}`, {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Failed to get recent sessions')
  }

  return response.json()
}
