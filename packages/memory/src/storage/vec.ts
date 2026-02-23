import type { Database } from 'bun:sqlite'
import { platform } from 'os'
import { join } from 'path'
import type { VecService } from './vec-types'
import { createDirectVecService } from './vec-direct'

export type { VecService, VecSearchResult } from './vec-types'

export function initializeVecTables(db: Database, dimensions: number): void {
  const direct = createDirectVecService(db)
  if (direct.available) {
    direct.initialize(dimensions)
  }
}

export async function createVecService(db: Database, dataDir: string, dimensions: number): Promise<VecService> {
  const direct = createDirectVecService(db)

  if (direct.available) {
    await direct.initialize(dimensions)
    return direct
  }

  if (platform() === 'darwin') {
    try {
      const { createWorkerVecService } = await import('./vec-client')
      const dbPath = join(dataDir, 'memory.db')
      const worker = await createWorkerVecService({ dbPath, dataDir, dimensions })
      if (worker.available) {
        await worker.initialize(dimensions)
        return worker
      }
    } catch {
      // Worker fallback unavailable
    }
  }

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
    dispose() {},
  }
}
