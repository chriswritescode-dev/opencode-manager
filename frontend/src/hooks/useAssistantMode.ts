import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAssistantModeStatus,
  initializeAssistantMode,
} from '@/api/repos'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { AssistantModeStatus, AssistantModeInitRequest } from '@opencode-manager/shared/types'

export function useAssistantMode(repoId?: number) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery<AssistantModeStatus>({
    queryKey: ['assistant-mode'],
    queryFn: () => getAssistantModeStatus(ASSISTANT_REPO_ID),
    enabled: repoId === ASSISTANT_REPO_ID,
  })

  const initializeMutation = useMutation({
    mutationFn: (options?: AssistantModeInitRequest) =>
      initializeAssistantMode(ASSISTANT_REPO_ID, options),
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
