import { useQueries } from '@tanstack/react-query'
import { getRepoSiblings } from '@/api/repos'
import { repoSiblingsQueryKey } from '@/hooks/useRepoSiblings'
import { buildWorktreeActivity, type ActiveWorktree } from '@/lib/activeWork'
import type { Repo } from '@/api/types'

/**
 * Discovers each repo's worktrees from its siblings while enabled, keyed by directory so a session
 * running in a worktree resolves to the repo that owns it. Each query is skipped for repos without
 * a positive id. `isLoading` is true while any enabled siblings query is still loading. `isError`
 * is true only when a siblings query has failed with no data, so a failed refetch that still has
 * cached data is not an error.
 */
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
