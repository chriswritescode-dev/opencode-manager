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

export interface ScheduleCount {
  total: number
  enabled: number
}

export async function listAllSchedules(): Promise<{ jobs: ScheduleJobWithRepo[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all`)
}

export async function listRepoSchedules(repoId: number): Promise<{ jobs: ScheduleJob[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules`)
}

export async function getScheduleCounts(): Promise<Map<number, ScheduleCount>> {
  const response = await fetchWrapper(`${API_BASE_URL}/api/schedules/all`)
  const jobs = response.jobs as ScheduleJobWithRepo[]
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
