import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAssistantModeStatus,
  initializeAssistantMode,
} from '@/api/repos'
import type { AssistantModeStatus, AssistantModeInitRequest } from '@opencode-manager/shared/types'

export function useAssistantMode(repoId?: number) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery<AssistantModeStatus>({
    queryKey: ['assistant-mode'],
    queryFn: () => getAssistantModeStatus(0),
    enabled: repoId === 0,
  })

  const initializeMutation = useMutation({
    mutationFn: (options?: AssistantModeInitRequest) =>
      initializeAssistantMode(0, options),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['assistant-mode'],
      })
    },
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    initialize: initializeMutation.mutateAsync,
    isInitializing: initializeMutation.isPending,
  }
}
