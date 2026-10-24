let cacheEpoch = 0

/**
 * Marks every cached repository lookup as stale so the next resolution sees the
 * current set of registered repositories.
 */
export function invalidateRepoEnvCache(): void {
  cacheEpoch += 1
}

export function repoEnvCacheEpoch(): number {
  return cacheEpoch
}
