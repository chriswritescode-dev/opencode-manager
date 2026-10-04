import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSessionPermissionMode, setSessionPermissionMode } from '@/api/sessionPermissionModes'
import { showToast } from '@/lib/toast'
import type { SessionPermissionModeState, SetSessionPermissionModeRequest } from '@opencode-manager/shared/schemas'

function sessionPermissionModeQueryKey(sessionId: string) {
  return ['session-permission-mode', sessionId] as const
}

export function useSessionPermissionMode(sessionId: string) {
  return useQuery({
    queryKey: sessionPermissionModeQueryKey(sessionId),
    queryFn: () => getSessionPermissionMode(sessionId),
    staleTime: 30000,
  })
}

export function useSetSessionPermissionMode(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetSessionPermissionModeRequest) => setSessionPermissionMode(sessionId, input),
    onSuccess: (state: SessionPermissionModeState) => {
      queryClient.setQueryData(sessionPermissionModeQueryKey(sessionId), state)
    },
    onError: () => {
      showToast.error('Failed to update permission mode')
    },
  })
}
