import type { CacheService } from './types'
import { InMemoryCacheService } from './memory-cache'

export type { CacheService } from './types'

export function createCacheService(): CacheService {
  return new InMemoryCacheService()
}
