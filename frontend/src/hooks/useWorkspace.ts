import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useAssistantMode } from '@/hooks/useAssistantMode'
import { isAssistantRepoId, workspaceFromAssistant, workspaceFromRepo } from '@/lib/schedules/workspace'
import type { Workspace } from '@/lib/schedules/workspace'

export function useWorkspace(repoId: number | undefined): {
  workspace: Workspace | undefined
  isLoading: boolean
  isError: boolean
} {
  const assistantQuery = useAssistantMode(repoId)

  const repoQuery = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined && repoId > 0,
  })

  if (isAssistantRepoId(repoId)) {
    return {
      workspace: assistantQuery.status ? workspaceFromAssistant(assistantQuery.status) : undefined,
      isLoading: assistantQuery.isLoading,
      isError: assistantQuery.isError,
    }
  }

  return {
    workspace: repoQuery.data ? workspaceFromRepo(repoQuery.data) : undefined,
    isLoading: repoQuery.isLoading,
    isError: repoQuery.isError,
  }
}
