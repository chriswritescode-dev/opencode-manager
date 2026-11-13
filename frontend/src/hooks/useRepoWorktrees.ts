import { useQueries } from '@tanstack/react-query'
import { getRepoSiblings } from '@/api/repos'
import { repoSiblingsQueryKey } from '@/hooks/useRepoSiblings'
import { buildWorktreeActivity, type ActiveWorktree } from '@/lib/activeWork'
import type { Repo } from '@/api/types'

export function useRepoWorktrees(
  repos: Repo[],
  enabled: boolean,
): { worktrees: ActiveWorktree[]; isLoading: boolean; isError: boolean } {
  return useQueries({
    queries: repos.map((repo) => ({
      queryKey: repoSiblingsQueryKey(repo.id),
      queryFn: () => getRepoSiblings(repo.id),
      enabled: enabled && repo.id > 0,
      staleTime: 30_000,
    })),
    combine: (results) => ({
      worktrees: buildWorktreeActivity(repos, results),
      isLoading: results.some((result) => result.isLoading),
      isError: results.some((result) => result.isError && result.data === undefined),
    }),
  })
}
