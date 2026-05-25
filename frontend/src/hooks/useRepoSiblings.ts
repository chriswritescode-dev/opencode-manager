import { useQuery } from '@tanstack/react-query'
import { getRepoSiblings, type RepoSibling } from '@/api/repos'

export function useRepoSiblings(repoId: number | undefined) {
  return useQuery<RepoSibling[]>({
    queryKey: ['repo', 'siblings', repoId],
    queryFn: () => getRepoSiblings(repoId!),
    enabled: !!repoId && repoId > 0,
    staleTime: 30_000,
  })
}
