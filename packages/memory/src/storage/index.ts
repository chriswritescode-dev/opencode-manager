export { initializeDatabase, closeDatabase, resolveDataDir, resolveLogPath } from './database'
export { createVecService } from './vec'
export type { VecService, VecSearchResult, TableDimensionsResult } from './vec-types'
export { createMemoryQuery } from './memory-queries'
export { createMetadataQuery } from './metadata-queries'

export type {
  Memory,
  MemoryScope,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchResult,
  MemoryStats,
  ListMemoriesFilter,
  CompactionConfig,
} from '../types'
