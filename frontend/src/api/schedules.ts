import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  CreateScheduleJobRequest,
  RemoveScheduleWorktreesRequest,
  ScheduleJob,
  ScheduleRun,
  ScheduleRunStatus,
  ScheduleRunWorktreesMode,
  ScheduleWorktree,
  UpdateScheduleJobRequest,
} from '@opencode-manager/shared/types'

export interface ScheduleRunSummary {
  id: number
  status: ScheduleRunStatus
  startedAt: number
  finishedAt: number | null
  viewedAt: number | null
  preview: string | null
}

export interface ScheduleJobWithRepo extends ScheduleJob {
  repoName: string
  repoPath: string
  repoUrl: string
  serverName: string | null
  lastRun: ScheduleRunSummary | null
  retainedWorktreeCount: number
}

export interface ScheduleRunWithContext extends ScheduleRun {
  jobName: string
  repoName: string
  repoPath: string
  serverName: string | null
}

export interface ScheduleServerTarget {
  serverId: string
  directory: string
}

export interface UnreadScheduleRun extends ScheduleRunWithContext {
  preview: string | null
}

export interface UnreadScheduleRunsResponse {
  runs: UnreadScheduleRun[]
  total: number
  failed: number
}

export interface ListAllRunsParams {
  limit?: number
  offset?: number
  status?: string
  repoId?: number
  jobId?: number
  triggerSource?: string
  runId?: number
  search?: string
}

export interface ScheduleCount {
  total: number
  enabled: number
}

export async function listAllSchedules(): Promise<{ jobs: ScheduleJobWithRepo[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all`)
}

export async function listAllScheduleRuns(params: ListAllRunsParams = {}): Promise<{ runs: ScheduleRunWithContext[] }> {
  const searchParams = new URLSearchParams()
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset))
  if (params.status) searchParams.set('status', params.status)
  if (params.repoId !== undefined) searchParams.set('repoId', String(params.repoId))
  if (params.jobId !== undefined) searchParams.set('jobId', String(params.jobId))
  if (params.triggerSource) searchParams.set('triggerSource', params.triggerSource)
  if (params.runId !== undefined) searchParams.set('runId', String(params.runId))
  if (params.search) searchParams.set('search', params.search)
  const qs = searchParams.toString()
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs${qs ? `?${qs}` : ''}`)
}

export async function listUnreadScheduleRuns(limit: number = 20): Promise<UnreadScheduleRunsResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs/unread?limit=${limit}`)
}

export async function markScheduleRunViewed(runId: number): Promise<{ updated: boolean }> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs/${runId}/viewed`, {
    method: 'POST',
  })
}

export async function markAllScheduleRunsViewed(): Promise<{ updated: number }> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs/viewed`, {
    method: 'POST',
  })
}

export async function getScheduleCounts(): Promise<Map<number, ScheduleCount>> {
  const response = await fetchWrapper<{ jobs: ScheduleJobWithRepo[] }>(`${API_BASE_URL}/api/schedules/all`)
  const jobs = response.jobs
  const counts = new Map<number, ScheduleCount>()

  jobs.forEach((job) => {
    if (job.repoId === null) {
      return
    }
    const existing = counts.get(job.repoId)
    if (existing) {
      existing.total += 1
      if (job.enabled) {
        existing.enabled += 1
      }
    } else {
      counts.set(job.repoId, { total: 1, enabled: job.enabled ? 1 : 0 })
    }
  })

  return counts
}

export async function getRepoSchedule(repoId: number, jobId: number): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}`)
}

export async function createRepoSchedule(repoId: number, data: CreateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateRepoSchedule(repoId: number, jobId: number, data: UpdateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteRepoSchedule(repoId: number, jobId: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}`, {
    method: 'DELETE',
  })
}

export async function runRepoSchedule(repoId: number, jobId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/run`, {
    method: 'POST',
  })
}

export async function listRepoScheduleRuns(repoId: number, jobId: number, limit: number = 20): Promise<{ runs: ScheduleRun[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs?limit=${limit}`)
}

export async function getRepoScheduleRun(repoId: number, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs/${runId}`)
}

export async function cancelRepoScheduleRun(repoId: number, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs/${runId}/cancel`, {
    method: 'POST',
  })
}

export async function clearRepoScheduleRuns(repoId: number, jobId: number, worktrees?: ScheduleRunWorktreesMode): Promise<{ cleared: number }> {
  const qs = worktrees ? `?worktrees=${worktrees}` : ''
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs${qs}`, {
    method: 'DELETE',
  })
}

export async function listScheduleWorktrees(repoId: number, jobId: number): Promise<{ worktrees: ScheduleWorktree[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/worktrees`)
}

export async function removeScheduleWorktrees(repoId: number, jobId: number, request: RemoveScheduleWorktreesRequest = {}): Promise<{ removed: number }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/worktrees`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function deleteRepoScheduleRun(repoId: number, jobId: number, runId: number, worktrees?: ScheduleRunWorktreesMode): Promise<void> {
  const qs = worktrees ? `?worktrees=${worktrees}` : ''
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs/${runId}${qs}`, {
    method: 'DELETE',
  })
}

function serverSchedulesPath(serverId: string): string {
  return `${API_BASE_URL}/api/opencode-servers/${encodeURIComponent(serverId)}/schedules`
}

export async function getServerSchedule(serverId: string, jobId: number): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}`)
}

export async function createServerSchedule(serverId: string, data: CreateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(serverSchedulesPath(serverId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateServerSchedule(serverId: string, jobId: number, data: UpdateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteServerSchedule(serverId: string, jobId: number): Promise<void> {
  return fetchWrapperVoid(`${serverSchedulesPath(serverId)}/${jobId}`, { method: 'DELETE' })
}

export async function runServerSchedule(serverId: string, jobId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/run`, { method: 'POST' })
}

export async function listServerScheduleRuns(serverId: string, jobId: number, limit: number = 20): Promise<{ runs: ScheduleRun[] }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs?limit=${limit}`)
}

export async function getServerScheduleRun(serverId: string, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs/${runId}`)
}

export async function cancelServerScheduleRun(serverId: string, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs/${runId}/cancel`, { method: 'POST' })
}

export async function clearServerScheduleRuns(serverId: string, jobId: number): Promise<{ cleared: number }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs`, { method: 'DELETE' })
}

export async function deleteServerScheduleRun(serverId: string, jobId: number, runId: number): Promise<void> {
  return fetchWrapperVoid(`${serverSchedulesPath(serverId)}/${jobId}/runs/${runId}`, { method: 'DELETE' })
}
