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

export function useDeleteRepoWorkspaces(repoId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workspaceIds: string[]) => {
      if (!repoId) throw new Error('Repo id is required')
      const results = await Promise.allSettled(
        workspaceIds.map((workspaceId) => deleteRepoWorkspace(repoId, workspaceId)),
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      return { total: workspaceIds.length, failed }
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['repo', 'siblings', repoId] })
      const deleted = total - failed
      if (failed === 0) {
        showToast.success(deleted === 1 ? 'Workspace deleted' : `${deleted} workspaces deleted`)
      } else if (deleted === 0) {
        showToast.error('Failed to delete workspaces')
      } else {
        showToast.error(`Deleted ${deleted}, failed ${failed}`)
      }
    },
    onError: () => {
      showToast.error('Failed to delete workspaces')
    },
  })
}
