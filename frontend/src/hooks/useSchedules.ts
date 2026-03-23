import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, UpdateScheduleJobRequest } from '@opencode-manager/shared/types'
import {
  cancelRepoScheduleRun,
  createRepoSchedule,
  deleteRepoSchedule,
  getRepoSchedule,
  getRepoScheduleRun,
  listAllSchedules,
  listRepoScheduleRuns,
  listRepoSchedules,
  runRepoSchedule,
  updateRepoSchedule,
} from '@/api/schedules'
import { showToast } from '@/lib/toast'
import type { ScheduleJobWithRepo } from '@/api/schedules'

export function useAllSchedules() {
  return useQuery({
    queryKey: ['all-schedules'],
    queryFn: async () => {
      const response = await listAllSchedules()
      return response.jobs as ScheduleJobWithRepo[]
    },
  })
}

export function useRepoSchedules(repoId: number | undefined) {
  return useQuery({
    queryKey: ['repo-schedules', repoId],
    queryFn: async () => {
      const response = await listRepoSchedules(repoId!)
      return response.jobs
    },
    enabled: repoId !== undefined,
    refetchInterval: 5000,
  })
}

export function useRepoSchedule(repoId: number | undefined, jobId: number | null) {
  return useQuery({
    queryKey: ['repo-schedule', repoId, jobId],
    queryFn: async () => {
      const response = await getRepoSchedule(repoId!, jobId!)
      return response.job
    },
    enabled: repoId !== undefined && jobId !== null,
    refetchInterval: jobId !== null ? 5000 : false,
  })
}

export function useRepoScheduleRuns(repoId: number | undefined, jobId: number | null, limit: number = 20) {
  return useQuery({
    queryKey: ['repo-schedule-runs', repoId, jobId, limit],
    queryFn: async () => {
      const response = await listRepoScheduleRuns(repoId!, jobId!, limit)
      return response.runs
    },
    enabled: repoId !== undefined && jobId !== null,
    refetchInterval: jobId !== null ? 5000 : false,
  })
}

export function useRepoScheduleRun(repoId: number | undefined, jobId: number | null, runId: number | null) {
  return useQuery({
    queryKey: ['repo-schedule-run', repoId, jobId, runId],
    queryFn: async () => {
      const response = await getRepoScheduleRun(repoId!, jobId!, runId!)
      return response.run
    },
    enabled: repoId !== undefined && jobId !== null && runId !== null,
    refetchInterval: runId !== null ? 5000 : false,
  })
}

export function useCreateRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId: callRepoId, data }: { repoId?: number; data: CreateScheduleJobRequest }) => {
      const resolvedRepoId = callRepoId ?? repoId
      const response = await createRepoSchedule(resolvedRepoId!, data)
      return response.job
    },
    onSuccess: (__variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', __variables.repoId ?? repoId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule created')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useUpdateRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId: callRepoId, jobId, data }: { repoId?: number; jobId: number; data: UpdateScheduleJobRequest }) => {
      const resolvedRepoId = callRepoId ?? repoId
      const response = await updateRepoSchedule(resolvedRepoId!, jobId, data)
      return response.job
    },
    onSuccess: (__variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', __variables.repoId ?? repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', __variables.repoId ?? repoId, __variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule updated')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeleteRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ repoId: callRepoId, jobId }: { repoId?: number; jobId: number }) => {
      const resolvedRepoId = callRepoId ?? repoId
      return deleteRepoSchedule(resolvedRepoId!, jobId)
    },
    onSuccess: (__variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', __variables.repoId ?? repoId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule deleted')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to delete schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useRunRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId: callRepoId, jobId }: { repoId?: number; jobId: number }) => {
      const resolvedRepoId = callRepoId ?? repoId
      const response = await runRepoSchedule(resolvedRepoId!, jobId)
      return response.run
    },
    onSuccess: (run, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', variables.repoId ?? repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', variables.repoId ?? repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', variables.repoId ?? repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-run', variables.repoId ?? repoId, run.jobId, run.id] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success(run.status === 'running' ? 'Schedule started' : 'Schedule run completed')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useCancelRepoScheduleRun(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ jobId, runId }: { jobId: number; runId: number }) => {
      const response = await cancelRepoScheduleRun(repoId!, jobId, runId)
      return response.run
    },
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-run', repoId, run.jobId, run.id] })
      showToast.success('Schedule run cancelled')
    },
    onError: (error) => {
      showToast.error(`Failed to cancel schedule run: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}
