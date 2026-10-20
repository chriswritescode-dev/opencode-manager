import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  cancelSessionGoal,
  getLatestSessionGoal,
  pauseSessionGoal,
  resumeSessionGoal,
  startSessionGoal,
} from '@/api/sessionGoals'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { serverScopedKey } from '@/lib/serverScope'
import { showToast } from '@/lib/toast'
import { SESSION_GOAL_POLL_INTERVAL_MS, type SessionGoal, type StartSessionGoalRequest } from '@opencode-manager/shared/schemas'

function sessionGoalQueryKey(sessionId: string, serverId: string) {
  return serverScopedKey(['session-goal', sessionId], serverId)
}

export function useSessionGoal(sessionId: string, options: { enabled?: boolean } = {}) {
  const serverId = useOpenCodeServerId()
  return useQuery({
    queryKey: sessionGoalQueryKey(sessionId, serverId),
    queryFn: () => getLatestSessionGoal(sessionId, serverId),
    enabled: options.enabled ?? true,
    refetchInterval: (query) => (query.state.data?.status === 'active' ? SESSION_GOAL_POLL_INTERVAL_MS : false),
  })
}

function useGoalMutation<TInput>(
  mutationFn: (input: TInput) => Promise<SessionGoal>,
  errorMessage: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (goal: SessionGoal) => {
      queryClient.setQueryData(sessionGoalQueryKey(goal.sessionId, goal.serverId), goal)
    },
    onError: (error: unknown) => {
      showToast.error(error instanceof Error ? error.message : errorMessage)
    },
  })
}

export function useStartSessionGoal() {
  const serverId = useOpenCodeServerId()
  return useGoalMutation(
    (input: StartSessionGoalRequest) => startSessionGoal({ ...input, serverId }),
    'Failed to start goal',
  )
}

export function usePauseSessionGoal() {
  return useGoalMutation(pauseSessionGoal, 'Failed to pause goal')
}

export function useResumeSessionGoal() {
  return useGoalMutation(resumeSessionGoal, 'Failed to resume goal')
}

export function useCancelSessionGoal() {
  return useGoalMutation(cancelSessionGoal, 'Failed to cancel goal')
}
