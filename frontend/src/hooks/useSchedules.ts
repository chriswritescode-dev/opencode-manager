import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, UpdateScheduleJobRequest } from '@opencode-manager/shared/types'
import {
  cancelRepoScheduleRun,
  createRepoSchedule,
  deleteRepoSchedule,
  getRepoSchedule,
  getRepoScheduleRun,
  listAllScheduleRuns,
  listAllSchedules,
  listRepoScheduleRuns,
  listRepoSchedules,
  runRepoSchedule,
  updateRepoSchedule,
} from '@/api/schedules'
import { showToast } from '@/lib/toast'
import type { ListAllRunsParams, ScheduleJobWithRepo, ScheduleRunWithContext } from '@/api/schedules'

export function useAllSchedules() {
  return useQuery({
    queryKey: ['all-schedules'],
    queryFn: async () => {
      const response = await listAllSchedules()
      return response.jobs as ScheduleJobWithRepo[]
    },
  })
}

export function useAllScheduleRuns(params: ListAllRunsParams, enabled: boolean = true) {
  return useQuery({
    queryKey: ['all-schedule-runs', params],
    queryFn: async () => {
      const response = await listAllScheduleRuns(params)
      return response.runs as ScheduleRunWithContext[]
    },
    enabled,
    refetchInterval: 5000,
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

export function useCreateRepoSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId, data }: { repoId: number; data: CreateScheduleJobRequest }) => {
      const response = await createRepoSchedule(repoId, data)
      return response.job
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', variables.repoId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule created')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useUpdateRepoSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId, jobId, data }: { repoId: number; jobId: number; data: UpdateScheduleJobRequest }) => {
      const response = await updateRepoSchedule(repoId, jobId, data)
      return response.job
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', variables.repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', variables.repoId, variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule updated')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeleteRepoSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ repoId, jobId }: { repoId: number; jobId: number }) => {
      return deleteRepoSchedule(repoId, jobId)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', variables.repoId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule deleted')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to delete schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useRunRepoSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId, jobId }: { repoId: number; jobId: number }) => {
      const response = await runRepoSchedule(repoId, jobId)
      return response.run
    },
    onSuccess: (run, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', variables.repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', variables.repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', variables.repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-run', variables.repoId, run.jobId, run.id] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success(run.status === 'running' ? 'Schedule started' : 'Schedule run completed')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useCancelRepoScheduleRun() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId, jobId, runId }: { repoId: number; jobId: number; runId: number }) => {
      const response = await cancelRepoScheduleRun(repoId, jobId, runId)
      return response.run
    },
    onSuccess: (run, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', variables.repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', variables.repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', variables.repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-run', variables.repoId, run.jobId, run.id] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule run cancelled')
    },
    onError: (error) => {
      showToast.error(`Failed to cancel schedule run: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}
