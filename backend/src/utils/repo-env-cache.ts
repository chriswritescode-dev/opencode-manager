let cacheEpoch = 0

export function invalidateRepoEnvCache(): void {
  cacheEpoch += 1
}

export function repoEnvCacheEpoch(): number {
  return cacheEpoch
}
