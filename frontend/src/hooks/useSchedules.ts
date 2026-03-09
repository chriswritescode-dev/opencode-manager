import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, UpdateScheduleJobRequest } from '@opencode-manager/shared/types'
import {
  cancelRepoScheduleRun,
  createRepoSchedule,
  deleteRepoSchedule,
  getRepoSchedule,
  getRepoScheduleRun,
  listRepoScheduleRuns,
  listRepoSchedules,
  runRepoSchedule,
  updateRepoSchedule,
} from '@/api/schedules'
import { showToast } from '@/lib/toast'

export function useRepoSchedules(repoId: number | undefined) {
  return useQuery({
    queryKey: ['repo-schedules', repoId],
    queryFn: () => listRepoSchedules(repoId!).then((response) => response.jobs),
    enabled: repoId !== undefined,
    refetchInterval: 5000,
  })
}

export function useRepoSchedule(repoId: number | undefined, jobId: number | null) {
  return useQuery({
    queryKey: ['repo-schedule', repoId, jobId],
    queryFn: () => getRepoSchedule(repoId!, jobId!).then((response) => response.job),
    enabled: repoId !== undefined && jobId !== null,
    refetchInterval: jobId !== null ? 5000 : false,
  })
}

export function useRepoScheduleRuns(repoId: number | undefined, jobId: number | null, limit: number = 20) {
  return useQuery({
    queryKey: ['repo-schedule-runs', repoId, jobId, limit],
    queryFn: () => listRepoScheduleRuns(repoId!, jobId!, limit).then((response) => response.runs),
    enabled: repoId !== undefined && jobId !== null,
    refetchInterval: jobId !== null ? 5000 : false,
  })
}

export function useRepoScheduleRun(repoId: number | undefined, jobId: number | null, runId: number | null) {
  return useQuery({
    queryKey: ['repo-schedule-run', repoId, jobId, runId],
    queryFn: () => getRepoScheduleRun(repoId!, jobId!, runId!).then((response) => response.run),
    enabled: repoId !== undefined && jobId !== null && runId !== null,
  })
}

export function useCreateRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateScheduleJobRequest) => createRepoSchedule(repoId!, data).then((response) => response.job),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repoId] })
      showToast.success('Schedule created')
    },
    onError: (error) => {
      showToast.error(`Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useUpdateRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ jobId, data }: { jobId: number; data: UpdateScheduleJobRequest }) =>
      updateRepoSchedule(repoId!, jobId, data).then((response) => response.job),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', repoId, variables.jobId] })
      showToast.success('Schedule updated')
    },
    onError: (error) => {
      showToast.error(`Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeleteRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: number) => deleteRepoSchedule(repoId!, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repoId] })
      showToast.success('Schedule deleted')
    },
    onError: (error) => {
      showToast.error(`Failed to delete schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useRunRepoSchedule(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: number) => runRepoSchedule(repoId!, jobId).then((response) => response.run),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', repoId, run.jobId] })
      showToast.success(run.status === 'running' ? 'Schedule started' : 'Schedule run completed')
    },
    onError: (error) => {
      showToast.error(`Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useCancelRepoScheduleRun(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ jobId, runId }: { jobId: number; runId: number }) =>
      cancelRepoScheduleRun(repoId!, jobId, runId).then((response) => response.run),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedules', repoId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', repoId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule', repoId, run.jobId] })
      showToast.success('Schedule run cancelled')
    },
    onError: (error) => {
      showToast.error(`Failed to cancel schedule run: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}
