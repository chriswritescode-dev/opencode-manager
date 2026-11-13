import { z } from 'zod'
import {
  ScheduleJobSchema,
  ScheduleRunSchema,
  ScheduleRunStatusSchema,
  ScheduleWorktreeSchema,
} from '@opencode-manager/shared/schemas'
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

const scheduleRunSummarySchema = z.object({
  id: z.number(),
  status: ScheduleRunStatusSchema,
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  viewedAt: z.number().nullable(),
  preview: z.string().nullable(),
})

const scheduleJobWithRepoSchema: z.ZodType<ScheduleJobWithRepo> = ScheduleJobSchema.extend({
  repoName: z.string(),
  repoPath: z.string(),
  repoUrl: z.string(),
  serverName: z.string().nullable(),
  lastRun: scheduleRunSummarySchema.nullable(),
  retainedWorktreeCount: z.number(),
})

const scheduleJobWithRepoListSchema = z.array(scheduleJobWithRepoSchema)

const scheduleRunWithContextBaseSchema = ScheduleRunSchema.extend({
  jobName: z.string(),
  repoName: z.string(),
  repoPath: z.string(),
  serverName: z.string().nullable(),
})

const scheduleRunWithContextSchema: z.ZodType<ScheduleRunWithContext> = scheduleRunWithContextBaseSchema

const unreadScheduleRunSchema = scheduleRunWithContextBaseSchema.extend({ preview: z.string().nullable() })

const unreadScheduleRunsResponseSchema: z.ZodType<UnreadScheduleRunsResponse> = z.object({
  runs: z.array(unreadScheduleRunSchema),
  total: z.number(),
  failed: z.number(),
})

const scheduleJobsResponseSchema = z.object({ jobs: scheduleJobWithRepoListSchema })
const scheduleJobResponseSchema = z.object({ job: ScheduleJobSchema })
const scheduleRunResponseSchema = z.object({ run: ScheduleRunSchema })
const scheduleRunWithContextListSchema = z.array(scheduleRunWithContextSchema)
const scheduleRunsWithContextResponseSchema = z.object({ runs: scheduleRunWithContextListSchema })
const scheduleRunsResponseSchema = z.object({ runs: z.array(ScheduleRunSchema) })
const scheduleWorktreesResponseSchema = z.object({ worktrees: z.array(ScheduleWorktreeSchema) })
const updatedFlagResponseSchema = z.object({ updated: z.boolean() })
const updatedCountResponseSchema = z.object({ updated: z.number() })
const clearedCountResponseSchema = z.object({ cleared: z.number() })
const removedCountResponseSchema = z.object({ removed: z.number() })

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
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all`, scheduleJobsResponseSchema)
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
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs${qs ? `?${qs}` : ''}`, scheduleRunsWithContextResponseSchema)
}

export async function listUnreadScheduleRuns(limit: number = 20): Promise<UnreadScheduleRunsResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs/unread?limit=${limit}`, unreadScheduleRunsResponseSchema)
}

export async function markScheduleRunViewed(runId: number): Promise<{ updated: boolean }> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs/${runId}/viewed`, updatedFlagResponseSchema, {
    method: 'POST',
  })
}

export async function markAllScheduleRunsViewed(): Promise<{ updated: number }> {
  return fetchWrapper(`${API_BASE_URL}/api/schedules/all/runs/viewed`, updatedCountResponseSchema, {
    method: 'POST',
  })
}

export async function getScheduleCounts(): Promise<Map<number, ScheduleCount>> {
  const response = await fetchWrapper(`${API_BASE_URL}/api/schedules/all`, scheduleJobsResponseSchema)
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
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}`, scheduleJobResponseSchema)
}

export async function createRepoSchedule(repoId: number, data: CreateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules`, scheduleJobResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateRepoSchedule(repoId: number, jobId: number, data: UpdateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}`, scheduleJobResponseSchema, {
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
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/run`, scheduleRunResponseSchema, {
    method: 'POST',
  })
}

export async function listRepoScheduleRuns(repoId: number, jobId: number, limit: number = 20): Promise<{ runs: ScheduleRun[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs?limit=${limit}`, scheduleRunsResponseSchema)
}

export async function getRepoScheduleRun(repoId: number, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs/${runId}`, scheduleRunResponseSchema)
}

export async function cancelRepoScheduleRun(repoId: number, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs/${runId}/cancel`, scheduleRunResponseSchema, {
    method: 'POST',
  })
}

export async function clearRepoScheduleRuns(repoId: number, jobId: number, worktrees?: ScheduleRunWorktreesMode): Promise<{ cleared: number }> {
  const qs = worktrees ? `?worktrees=${worktrees}` : ''
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/runs${qs}`, clearedCountResponseSchema, {
    method: 'DELETE',
  })
}

export async function listScheduleWorktrees(repoId: number, jobId: number): Promise<{ worktrees: ScheduleWorktree[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/worktrees`, scheduleWorktreesResponseSchema)
}

export async function removeScheduleWorktrees(repoId: number, jobId: number, request: RemoveScheduleWorktreesRequest = {}): Promise<{ removed: number }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/schedules/${jobId}/worktrees`, removedCountResponseSchema, {
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
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}`, scheduleJobResponseSchema)
}

export async function createServerSchedule(serverId: string, data: CreateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(serverSchedulesPath(serverId), scheduleJobResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateServerSchedule(serverId: string, jobId: number, data: UpdateScheduleJobRequest): Promise<{ job: ScheduleJob }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}`, scheduleJobResponseSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteServerSchedule(serverId: string, jobId: number): Promise<void> {
  return fetchWrapperVoid(`${serverSchedulesPath(serverId)}/${jobId}`, { method: 'DELETE' })
}

export async function runServerSchedule(serverId: string, jobId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/run`, scheduleRunResponseSchema, { method: 'POST' })
}

export async function listServerScheduleRuns(serverId: string, jobId: number, limit: number = 20): Promise<{ runs: ScheduleRun[] }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs?limit=${limit}`, scheduleRunsResponseSchema)
}

export async function getServerScheduleRun(serverId: string, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs/${runId}`, scheduleRunResponseSchema)
}

export async function cancelServerScheduleRun(serverId: string, jobId: number, runId: number): Promise<{ run: ScheduleRun }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs/${runId}/cancel`, scheduleRunResponseSchema, { method: 'POST' })
}

export async function clearServerScheduleRuns(serverId: string, jobId: number): Promise<{ cleared: number }> {
  return fetchWrapper(`${serverSchedulesPath(serverId)}/${jobId}/runs`, clearedCountResponseSchema, { method: 'DELETE' })
}

export async function deleteServerScheduleRun(serverId: string, jobId: number, runId: number): Promise<void> {
  return fetchWrapperVoid(`${serverSchedulesPath(serverId)}/${jobId}/runs/${runId}`, { method: 'DELETE' })
}
