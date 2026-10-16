import { useQueries } from '@tanstack/react-query'
import { getRepoSiblings } from '@/api/repos'
import { repoSiblingsQueryKey } from '@/hooks/useRepoSiblings'
import { buildWorktreeActivity, type ActiveWorktree } from '@/lib/activeWork'
import type { Repo } from '@/api/types'

/**
 * Discovers each repo's worktrees from its siblings while enabled, keyed by directory so a session
 * running in a worktree resolves to the repo that owns it. Each query is skipped for repos without
 * a positive id. `isLoading` is true while any enabled siblings query is still loading.
 */
export function useRepoWorktrees(
  repos: Repo[],
  enabled: boolean,
): { worktrees: ActiveWorktree[]; isLoading: boolean } {
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
    }),
  })
}
