import { FetchError } from '@/api/fetchWrapper'
import { getRepo } from '@/api/repos'

export function repoQueryOptions(repoId: number) {
  return {
    queryKey: ['repo', repoId] as const,
    queryFn: () => getRepo(repoId),
    retry: (failureCount: number, cause: unknown) =>
      !(cause instanceof FetchError && cause.statusCode === 404) && failureCount < 3,
  }
}
