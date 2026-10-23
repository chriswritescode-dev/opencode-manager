import { FetchError } from '@/api/fetchWrapper'
import { getRepo } from '@/api/repos'

/**
 * Options for the shared `['repo', id]` query. A missing repository is a terminal answer, so a 404
 * skips React Query's retry backoff that would otherwise hold the page spinner for seconds.
 */
export function repoQueryOptions(repoId: number) {
  return {
    queryKey: ['repo', repoId] as const,
    queryFn: () => getRepo(repoId),
    retry: (failureCount: number, error: unknown) =>
      !(error instanceof FetchError && error.statusCode === 404) && failureCount < 3,
  }
}
