import type { Database } from 'bun:sqlite'
import { join } from 'path'
import type { VecService } from './vec-types'
import type { Logger } from '../types'

export type { VecService, VecSearchResult } from './vec-types'

export async function createVecService(_db: Database, dataDir: string, dimensions: number, logger?: Logger): Promise<VecService> {
  try {
    const { createWorkerVecService } = await import('./vec-client')
    const dbPath = join(dataDir, 'memory.db')
    const worker = await createWorkerVecService({ dbPath, dataDir, dimensions })
    if (worker.available) {
      await worker.initialize(dimensions)
      return worker
    }
    logger?.error('Vec worker started but not available')
  } catch (err) {
    logger?.error('Vec worker failed to start', err)
  }

  logger?.log('Vec worker unavailable, using noop service')
  return createNoopVecService()
}

export function createNoopVecService(): VecService {
  return {
    get available() { return false },
    async initialize() {},
    async insert() {},
    async delete() {},
    async deleteByProject() {},
    async deleteByMemoryIds() {},
    async search() { return [] },
    async findSimilar() { return [] },
    async countWithoutEmbeddings() { return 0 },
    async getWithoutEmbeddings() { return [] },
    async recreateTable() {},
    async getDimensions() { return { exists: false, dimensions: null } },
    dispose() {},
  }
}
