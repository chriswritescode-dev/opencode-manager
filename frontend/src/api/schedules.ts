import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  CreateScheduleJobRequest,
  ScheduleJob,
  ScheduleRun,
  UpdateScheduleJobRequest,
} from '@opencode-manager/shared/types'

export interface ScheduleJobWithRepo extends ScheduleJob {
  repoName: string
  repoPath: string
  repoUrl: string
}

export interface ScheduleRunWithContext extends ScheduleRun {
  jobName: string
  repoName: string
  repoPath: string
}

export interface ListAllRunsParams {
  limit?: number
  offset?: number
  status?: string
  repoId?: number
  jobId?: number
  triggerSource?: string
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
  const qs = searchParams.toString()
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs${qs ? `?${qs}` : ''}`)
}

export async function listRepoSchedules(repoId: number): Promise<{ jobs: ScheduleJob[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules`)
}

export async function getScheduleCounts(): Promise<Map<number, ScheduleCount>> {
  const response = await fetchWrapper<{ jobs: ScheduleJobWithRepo[] }>(`${API_BASE_URL}/api/schedules/all`)
  const jobs = response.jobs
  const counts = new Map<number, ScheduleCount>()

  jobs.forEach((job) => {
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
