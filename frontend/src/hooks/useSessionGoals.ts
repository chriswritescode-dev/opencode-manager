import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  cancelSessionGoal,
  getLatestSessionGoal,
  pauseSessionGoal,
  resumeSessionGoal,
  startSessionGoal,
} from '@/api/sessionGoals'
import { showToast } from '@/lib/toast'
import { SESSION_GOAL_POLL_INTERVAL_MS, type SessionGoal, type StartSessionGoalRequest } from '@opencode-manager/shared/schemas'

function sessionGoalQueryKey(sessionId: string) {
  return ['session-goal', sessionId] as const
}

export function useSessionGoal(sessionId: string) {
  return useQuery({
    queryKey: sessionGoalQueryKey(sessionId),
    queryFn: () => getLatestSessionGoal(sessionId),
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
      queryClient.setQueryData(sessionGoalQueryKey(goal.sessionId), goal)
    },
    onError: (error: unknown) => {
      showToast.error(error instanceof Error ? error.message : errorMessage)
    },
  })
}

export function useStartSessionGoal() {
  return useGoalMutation((input: StartSessionGoalRequest) => startSessionGoal(input), 'Failed to start goal')
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
