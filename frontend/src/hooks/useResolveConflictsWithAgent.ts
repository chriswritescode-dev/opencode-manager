import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { createSessionWithPrompt } from '@/api/opencode'
import { buildConflictResolutionPrompt } from '@/lib/git-conflict-prompt'
import { getSessionPath } from '@/lib/navigation'
import { invalidateSessionListCaches } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'
import type { GitOperationState } from '@opencode-manager/shared'

interface ResolveConflictsInput {
  operation: GitOperationState
  branch: string
}

interface ResolveConflictsRepo {
  id: number
  fullPath: string
}

export function useResolveConflictsWithAgent(repo: ResolveConflictsRepo) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: async ({ operation, branch }: ResolveConflictsInput) => {
      return createSessionWithPrompt(
        {
          directory: repo.fullPath,
          title: `Resolve ${operation.kind} conflicts`,
        },
        buildConflictResolutionPrompt({ operation, branch }),
      )
    },
    onSuccess: (session) => {
      invalidateSessionListCaches(queryClient)
      navigate(getSessionPath(repo.id, session.id))
    },
    onError: (error) => {
      showToast.error(
        `Could not start conflict resolution: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    },
  })
}
