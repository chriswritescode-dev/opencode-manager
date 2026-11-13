import { useMutation, useQuery, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query'
import { getSessionGoal, runCommand, type RunCommandInput } from '@/api/opencode'
import { isLocalOpenCodeServer, useOpenCodeServerId } from '@/contexts/opencode-server-context'
import { useSyncSessionSelection } from '@/hooks/useOpenCode'
import { serverScopedKey } from '@/lib/serverScope'
import { showToast } from '@/lib/toast'
import {
  GOAL_COMMAND_NAME,
  goalChangeFromEvent,
  type ModelRef,
  type SessionGoalRead,
} from '@opencode-manager/shared/opencode'

export const SESSION_GOAL_QUERY_ROOT = 'session-goal'

const SESSION_GOAL_KEY_BASE_LENGTH = 3

function sessionGoalQueryKey(sessionID: string, directory: string | undefined, serverId: string) {
  return serverScopedKey([SESSION_GOAL_QUERY_ROOT, sessionID, directory], serverId)
}

function isSessionGoalQueryFor(query: Query, sessionID: string, serverId: string): boolean {
  const { queryKey } = query
  if (queryKey[0] !== SESSION_GOAL_QUERY_ROOT || queryKey[1] !== sessionID) return false
  if (isLocalOpenCodeServer(serverId)) return queryKey.length === SESSION_GOAL_KEY_BASE_LENGTH
  return (
    queryKey.length === SESSION_GOAL_KEY_BASE_LENGTH + 1
    && queryKey[SESSION_GOAL_KEY_BASE_LENGTH] === serverId
  )
}

function sessionGoalQueryPredicate(sessionID: string, serverId: string) {
  return (query: Query) => isSessionGoalQueryFor(query, sessionID, serverId)
}

export function useSessionGoal(sessionID: string, directory: string | undefined) {
  const serverId = useOpenCodeServerId()
  return useQuery<SessionGoalRead>({
    queryKey: sessionGoalQueryKey(sessionID, directory, serverId),
    queryFn: () => getSessionGoal(sessionID, directory, serverId),
    enabled: Boolean(directory),
  })
}

export function applySessionGoalEvent(
  queryClient: QueryClient,
  event: { type: string; data: unknown },
  serverId: string,
): boolean {
  const change = goalChangeFromEvent(event)
  if (!change) return false
  const nextGoal: SessionGoalRead = { supported: true, goal: change.goal }
  const predicate = sessionGoalQueryPredicate(change.sessionID, serverId)
  void queryClient.cancelQueries({ predicate })
  queryClient.setQueriesData<SessionGoalRead>({ predicate }, nextGoal)
  return true
}

type GoalCommandInput = Omit<RunCommandInput, 'name' | 'delivery'> & {
  model?: ModelRef
  agent?: string
}

export function useSessionGoalCommand(directory: string | undefined) {
  const serverId = useOpenCodeServerId()
  const queryClient = useQueryClient()
  const syncSelection = useSyncSessionSelection(directory)
  return useMutation({
    mutationFn: async ({ model, agent, ...command }: GoalCommandInput) => {
      await syncSelection({ sessionID: command.sessionID, model, agent })
      await runCommand({ ...command, name: GOAL_COMMAND_NAME }, serverId)
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ predicate: sessionGoalQueryPredicate(input.sessionID, serverId) })
    },
    onError: (error: Error) => {
      showToast.error(error.message ?? 'Goal command failed')
    },
  })
}
