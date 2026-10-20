import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSessionPermissionMode, setSessionPermissionMode } from '@/api/sessionPermissionModes'
import { useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { serverScopedKey } from '@/lib/serverScope'
import { showToast } from '@/lib/toast'
import type { SessionPermissionModeState, SetSessionPermissionModeRequest } from '@opencode-manager/shared/schemas'

function sessionPermissionModeQueryKey(sessionId: string, serverId: string) {
  return serverScopedKey(['session-permission-mode', sessionId], serverId)
}

export function useSessionPermissionMode(sessionId: string, options: { enabled?: boolean } = {}) {
  const serverId = useOpenCodeServerId()
  return useQuery({
    queryKey: sessionPermissionModeQueryKey(sessionId, serverId),
    queryFn: () => getSessionPermissionMode(sessionId, serverId),
    enabled: options.enabled ?? true,
    staleTime: 30000,
  })
}

export function useSetSessionPermissionMode(sessionId: string) {
  const queryClient = useQueryClient()
  const serverId = useOpenCodeServerId()
  return useMutation({
    mutationFn: (input: SetSessionPermissionModeRequest) =>
      setSessionPermissionMode(sessionId, input, serverId),
    onSuccess: (state: SessionPermissionModeState) => {
      queryClient.setQueryData(sessionPermissionModeQueryKey(sessionId, serverId), state)
    },
    onError: () => {
      showToast.error('Failed to update permission mode')
    },
  })
}
