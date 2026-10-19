import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, ScheduleRunWorktreesMode, UpdateScheduleJobRequest } from '@opencode-manager/shared/types'
import {
  cancelRepoScheduleRun,
  cancelServerScheduleRun,
  clearRepoScheduleRuns,
  clearServerScheduleRuns,
  createRepoSchedule,
  createServerSchedule,
  deleteRepoSchedule,
  deleteRepoScheduleRun,
  deleteServerSchedule,
  deleteServerScheduleRun,
  getRepoSchedule,
  getRepoScheduleRun,
  getServerSchedule,
  getServerScheduleRun,
  listAllScheduleRuns,
  listAllSchedules,
  listRepoScheduleRuns,
  listServerScheduleRuns,
  listScheduleWorktrees,
  listUnreadScheduleRuns,
  markAllScheduleRunsViewed,
  markScheduleRunViewed,
  removeScheduleWorktrees,
  runRepoSchedule,
  runServerSchedule,
  updateRepoSchedule,
  updateServerSchedule,
} from '@/api/schedules'
import { showToast } from '@/lib/toast'
import type { ListAllRunsParams, ScheduleJobWithRepo, ScheduleRunWithContext } from '@/api/schedules'

export const UNREAD_SCHEDULE_RUNS_QUERY_KEY = ['schedule-runs-unread'] as const

export type ScheduleTargetRef =
  | { kind: 'repo'; repoId: number }
  | { kind: 'server'; serverId: string }

function invalidateScheduleQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
  queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
  queryClient.invalidateQueries({ queryKey: ['repo-schedule'] })
  queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs'] })
  queryClient.invalidateQueries({ queryKey: ['server-schedule'] })
  queryClient.invalidateQueries({ queryKey: ['server-schedule-runs'] })
}

export function useAllSchedules() {
  return useQuery({
    queryKey: ['all-schedules'],
    queryFn: async () => {
      const response = await listAllSchedules()
      return response.jobs as ScheduleJobWithRepo[]
    },
    refetchInterval: 10000,
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

export function useUnreadScheduleRuns() {
  return useQuery({
    queryKey: UNREAD_SCHEDULE_RUNS_QUERY_KEY,
    queryFn: () => listUnreadScheduleRuns(),
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  })
}

export function useMarkScheduleRunViewed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (runId: number) => markScheduleRunViewed(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNREAD_SCHEDULE_RUNS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
    },
  })
}

export function useMarkAllScheduleRunsViewed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => markAllScheduleRunsViewed(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNREAD_SCHEDULE_RUNS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
      showToast.success('All reports marked as read')
    },
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

export function useClearRepoScheduleRuns() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId, jobId, worktrees }: { repoId: number; jobId: number; worktrees?: ScheduleRunWorktreesMode }) => {
      return clearRepoScheduleRuns(repoId, jobId, worktrees)
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', variables.repoId, variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
      queryClient.invalidateQueries({ queryKey: ['schedule-worktrees', variables.repoId, variables.jobId] })
      showToast.success(result.cleared > 0 ? `Cleared ${result.cleared} run${result.cleared === 1 ? '' : 's'}` : 'No runs to clear')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to clear run history: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeleteRepoScheduleRun() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ repoId, jobId, runId, worktrees }: { repoId: number; jobId: number; runId: number; worktrees?: ScheduleRunWorktreesMode }) => {
      return deleteRepoScheduleRun(repoId, jobId, runId, worktrees)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', variables.repoId, variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
      queryClient.invalidateQueries({ queryKey: ['schedule-worktrees', variables.repoId, variables.jobId] })
      showToast.success('Run deleted')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to delete run: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useScheduleWorktrees(repoId: number | undefined, jobId: number | null) {
  return useQuery({
    queryKey: ['schedule-worktrees', repoId, jobId],
    queryFn: async () => {
      const response = await listScheduleWorktrees(repoId!, jobId!)
      return response.worktrees
    },
    enabled: repoId !== undefined && jobId !== null,
    refetchInterval: jobId !== null ? 10000 : false,
  })
}

export function useRemoveScheduleWorktrees() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ repoId, jobId, worktreePath }: { repoId: number; jobId: number; worktreePath?: string }) => {
      return removeScheduleWorktrees(repoId, jobId, worktreePath ? { worktreePath } : {})
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-worktrees', variables.repoId, variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['repo-schedule-runs', variables.repoId, variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      queryClient.invalidateQueries({ queryKey: ['repo', 'siblings'] })
      showToast.success(`Removed ${result.removed} worktree${result.removed === 1 ? '' : 's'}`)
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useServerSchedule(serverId: string | undefined, jobId: number | null) {
  return useQuery({
    queryKey: ['server-schedule', serverId, jobId],
    queryFn: async () => (await getServerSchedule(serverId!, jobId!)).job,
    enabled: Boolean(serverId) && jobId !== null,
    refetchInterval: jobId !== null ? 5000 : false,
  })
}

export function useServerScheduleRuns(serverId: string | undefined, jobId: number | null, limit: number = 20) {
  return useQuery({
    queryKey: ['server-schedule-runs', serverId, jobId, limit],
    queryFn: async () => (await listServerScheduleRuns(serverId!, jobId!, limit)).runs,
    enabled: Boolean(serverId) && jobId !== null,
    refetchInterval: jobId !== null ? 5000 : false,
  })
}

export function useServerScheduleRun(serverId: string | undefined, jobId: number | null, runId: number | null) {
  return useQuery({
    queryKey: ['server-schedule-run', serverId, jobId, runId],
    queryFn: async () => (await getServerScheduleRun(serverId!, jobId!, runId!)).run,
    enabled: Boolean(serverId) && jobId !== null && runId !== null,
    refetchInterval: runId !== null ? 5000 : false,
  })
}

export function useScheduleRunDetail(run: { repoId: number | null; serverId?: string; jobId: number; id: number } | null) {
  const serverId = run && run.repoId === null ? run.serverId : undefined
  return useQuery({
    queryKey: ['schedule-run-detail', run?.repoId ?? null, serverId ?? null, run?.jobId ?? null, run?.id ?? null],
    queryFn: async () => {
      if (!run) return null
      if (run.repoId === null) {
        if (!run.serverId) return null
        return (await getServerScheduleRun(run.serverId, run.jobId, run.id)).run
      }
      return (await getRepoScheduleRun(run.repoId, run.jobId, run.id)).run
    },
    enabled: run !== null && (run.repoId !== null || Boolean(run.serverId)),
    refetchInterval: run !== null ? 5000 : false,
  })
}

export function useCreateServerSchedule(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateScheduleJobRequest) => (await createServerSchedule(serverId, data)).job,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule created')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useUpdateServerSchedule(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ jobId, data }: { jobId: number; data: UpdateScheduleJobRequest }) =>
      (await updateServerSchedule(serverId, jobId, data)).job,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['server-schedule', serverId, variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule updated')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeleteServerSchedule(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: number) => deleteServerSchedule(serverId, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule deleted')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to delete schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useRunServerSchedule(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (jobId: number) => (await runServerSchedule(serverId, jobId)).run,
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['server-schedule-runs', serverId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['server-schedule', serverId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success(run.status === 'running' ? 'Schedule started' : 'Schedule run completed')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useCancelServerScheduleRun(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ jobId, runId }: { jobId: number; runId: number }) =>
      (await cancelServerScheduleRun(serverId, jobId, runId)).run,
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['server-schedule-runs', serverId, run.jobId] })
      queryClient.invalidateQueries({ queryKey: ['server-schedule-run', serverId, run.jobId, run.id] })
      queryClient.invalidateQueries({ queryKey: ['all-schedules'] })
      showToast.success('Schedule run cancelled')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to cancel schedule run: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useClearServerScheduleRuns(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: number) => clearServerScheduleRuns(serverId, jobId),
    onSuccess: (result, jobId) => {
      queryClient.invalidateQueries({ queryKey: ['server-schedule-runs', serverId, jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
      showToast.success(result.cleared > 0 ? `Cleared ${result.cleared} run${result.cleared === 1 ? '' : 's'}` : 'No runs to clear')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to clear run history: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeleteServerScheduleRun(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ jobId, runId }: { jobId: number; runId: number }) => deleteServerScheduleRun(serverId, jobId, runId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['server-schedule-runs', serverId, variables.jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-schedule-runs'] })
      showToast.success('Run deleted')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to delete run: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useUpdateScheduleTarget() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ target, jobId, data }: { target: ScheduleTargetRef; jobId: number; data: UpdateScheduleJobRequest }) => {
      const response = target.kind === 'repo'
        ? await updateRepoSchedule(target.repoId, jobId, data)
        : await updateServerSchedule(target.serverId, jobId, data)
      return response.job
    },
    onSuccess: () => {
      invalidateScheduleQueries(queryClient)
      showToast.success('Schedule updated')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useDeleteScheduleTarget() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ target, jobId }: { target: ScheduleTargetRef; jobId: number }) => {
      if (target.kind === 'repo') {
        await deleteRepoSchedule(target.repoId, jobId)
        return
      }
      await deleteServerSchedule(target.serverId, jobId)
    },
    onSuccess: () => {
      invalidateScheduleQueries(queryClient)
      showToast.success('Schedule deleted')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to delete schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useRunScheduleTarget() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ target, jobId }: { target: ScheduleTargetRef; jobId: number }) => {
      const response = target.kind === 'repo'
        ? await runRepoSchedule(target.repoId, jobId)
        : await runServerSchedule(target.serverId, jobId)
      return response.run
    },
    onSuccess: (run) => {
      invalidateScheduleQueries(queryClient)
      showToast.success(run.status === 'running' ? 'Schedule started' : 'Schedule run completed')
    },
    onError: (error: unknown) => {
      showToast.error(`Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

export function useCancelScheduleTargetRun() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ target, jobId, runId }: { target: ScheduleTargetRef; jobId: number; runId: number }) => {
      const response = target.kind === 'repo'
        ? await cancelRepoScheduleRun(target.repoId, jobId, runId)
        : await cancelServerScheduleRun(target.serverId, jobId, runId)
      return response.run
    },
    onSuccess: () => {
      invalidateScheduleQueries(queryClient)
      showToast.success('Schedule run cancelled')
    },
    onError: (error) => {
      showToast.error(`Failed to cancel schedule run: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}
