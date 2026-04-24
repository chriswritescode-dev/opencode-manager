import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAssistantModeStatus,
  initializeAssistantMode,
} from '@/api/repos'
import type { AssistantModeStatus, AssistantModeInitRequest } from '@opencode-manager/shared/types'

export function useAssistantMode(repoId: number) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery<AssistantModeStatus>({
    queryKey: ['repo', repoId, 'assistant-mode'],
    queryFn: () => getAssistantModeStatus(repoId),
    enabled: !!repoId,
  })

  const initializeMutation = useMutation({
    mutationFn: (options?: AssistantModeInitRequest) =>
      initializeAssistantMode(repoId, options),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['repo', repoId, 'assistant-mode'],
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
