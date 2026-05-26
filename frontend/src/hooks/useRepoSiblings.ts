import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteRepoWorkspace, getRepoSiblings, type RepoSibling } from '@/api/repos'
import { showToast } from '@/lib/toast'

export function useRepoSiblings(repoId: number | undefined) {
  return useQuery<RepoSibling[]>({
    queryKey: ['repo', 'siblings', repoId],
    queryFn: () => getRepoSiblings(repoId!),
    enabled: !!repoId && repoId > 0,
    staleTime: 30_000,
  })
}

export function useDeleteRepoWorkspace(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (workspaceId: string) => {
      if (!repoId) throw new Error('Repo id is required')
      return deleteRepoWorkspace(repoId, workspaceId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo', 'siblings', repoId] })
      showToast.success('Workspace deleted')
    },
    onError: () => {
      showToast.error('Failed to delete workspace')
    },
  })
}
