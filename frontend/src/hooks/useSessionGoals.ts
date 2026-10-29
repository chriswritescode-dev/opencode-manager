import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getSessionGoal, runCommand, type RunCommandInput } from '@/api/opencode'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { useSyncSessionSelection } from '@/hooks/useOpenCode'
import { serverScopedKey } from '@/lib/serverScope'
import { showToast } from '@/lib/toast'
import {
  GOAL_COMMAND_NAME,
  goalChangeFromEvent,
  type ModelRef,
  type SessionGoalRead,
} from '@opencode-manager/shared/opencode'

/** Root segment shared by every session goal query key. */
export const SESSION_GOAL_QUERY_ROOT = 'session-goal'

function sessionGoalQueryKey(sessionID: string, serverId: string) {
  return serverScopedKey([SESSION_GOAL_QUERY_ROOT, sessionID], serverId)
}

/**
 * Reads the goal of a session through the OpenCode goal RPC.
 *
 * @param sessionID The session whose goal is read.
 * @param directory Directory of the session's project, once it is known.
 * @returns The query holding the goal, or an unsupported result when the server has no goal RPC.
 */
export function useSessionGoal(sessionID: string, directory: string | undefined) {
  const serverId = useOpenCodeServerId()
  return useQuery<SessionGoalRead>({
    queryKey: sessionGoalQueryKey(sessionID, serverId),
    queryFn: () => getSessionGoal(sessionID, directory, serverId),
    enabled: Boolean(directory),
  })
}

/**
 * Applies a goal change event to the session's cached goal.
 *
 * @param queryClient Cache that holds the session goal.
 * @param event Event received from the OpenCode server.
 * @param serverId Server that owns the session.
 * @returns Whether the event was a goal change and updated the cache.
 */
export function applySessionGoalEvent(
  queryClient: QueryClient,
  event: { type: string; data: unknown },
  serverId: string,
): boolean {
  const change = goalChangeFromEvent(event)
  if (!change) return false
  const nextGoal: SessionGoalRead = { supported: true, goal: change.goal }
  const queryKey = sessionGoalQueryKey(change.sessionID, serverId)
  void queryClient.cancelQueries({ queryKey })
  queryClient.setQueryData<SessionGoalRead>(queryKey, nextGoal)
  return true
}

type GoalCommandInput = Omit<RunCommandInput, 'name' | 'delivery'> & {
  model?: ModelRef
  agent?: string
}

/**
 * Runs the `/goal` command on a session and refreshes the session's goal afterwards.
 *
 * @param directory Directory of the session's project, used to sync the session model and agent.
 * @returns The mutation that sends the goal command.
 */
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
      void queryClient.invalidateQueries({ queryKey: sessionGoalQueryKey(input.sessionID, serverId) })
    },
    onError: (error: Error) => {
      showToast.error(error.message ?? 'Goal command failed')
    },
  })
}
