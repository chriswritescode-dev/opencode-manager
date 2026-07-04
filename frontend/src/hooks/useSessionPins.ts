import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listSessionPins, toggleSessionPin } from '@/api/sessionPins'
import type { SessionPin, ToggleSessionPinRequest } from '@opencode-manager/shared/schemas'

export const SESSION_PINS_QUERY_KEY = ['session-pins'] as const

export function useSessionPins() {
  return useQuery({
    queryKey: SESSION_PINS_QUERY_KEY,
    queryFn: listSessionPins,
    staleTime: 30000,
  })
}

export function useToggleSessionPin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ToggleSessionPinRequest) => toggleSessionPin(input),
    onSuccess: (pins: SessionPin[]) => {
      queryClient.setQueryData(SESSION_PINS_QUERY_KEY, pins)
    },
  })
}
