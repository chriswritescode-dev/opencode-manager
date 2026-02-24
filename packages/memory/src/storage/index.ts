export { initializeDatabase, closeDatabase, resolveDataDir, resolveLogPath } from './database'
export { createVecService } from './vec'
export { getTableDimensions, recreateVecTable } from './vec-utils'
export type { TableDimensionsResult } from './vec-utils'
export type { VecService, VecSearchResult } from './vec-types'
export { createMemoryQuery } from './memory-queries'
export { createSessionStateQueries } from './session-state-queries'
export { createMetadataQuery } from './metadata-queries'

export type {
  Memory,
  MemoryScope,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchResult,
  MemoryStats,
  ListMemoriesFilter,
  SessionState,
  PlanningState,
  PreCompactionSnapshot,
  CompactionConfig,
} from '../types'
