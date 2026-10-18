import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSessionSandbox, setSessionSandbox } from '@/api/sessionSandbox'
import { showToast } from '@/lib/toast'
import { FetchError } from '@/api/fetchWrapper'
import type { SessionSandboxState, SetSessionSandboxRequest } from '@opencode-manager/shared/schemas'

function sessionSandboxQueryKey(sessionId: string) {
  return ['session-sandbox', sessionId] as const
}

export function useSessionSandbox(sessionId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: sessionSandboxQueryKey(sessionId),
    queryFn: () => getSessionSandbox(sessionId),
    enabled: options.enabled ?? true,
    staleTime: 30000,
  })
}

export function useSetSessionSandbox(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetSessionSandboxRequest) => setSessionSandbox(sessionId, input),
    onSuccess: (state: SessionSandboxState) => {
      queryClient.setQueryData(sessionSandboxQueryKey(sessionId), state)
    },
    onError: (error) => {
      showToast.error(error instanceof FetchError ? error.message : 'Failed to update sandbox mode')
    },
  })
}
