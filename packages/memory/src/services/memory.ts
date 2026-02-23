import { Database } from 'bun:sqlite'
import { createMemoryQuery, type CreateMemoryInput, type UpdateMemoryInput, type MemorySearchResult } from '../storage'
import type { VecService } from '../storage/vec-types'
import { createNoopVecService } from '../storage/vec'
import { type EmbeddingService, type EmbeddingProvider, createEmbeddingService } from '../embedding'
import { type CacheService, createCacheService } from '../cache'
import type { Memory, MemoryScope, MemoryStats, Logger } from '../types'

const DEFAULT_DEDUP_THRESHOLD = 0.25

function createNoopEmbeddingProvider(): EmbeddingProvider {
  return {
    dimensions: 0,
    name: 'noop',
    ready: false,
    embed: async () => [],
    test: async () => false,
    warmup: () => {},
  }
}

export interface MemoryServiceDeps {
  db: Database
  provider?: EmbeddingProvider
  embeddingService: EmbeddingService
  cache: CacheService
  vec?: VecService
  logger?: Logger
}

export class MemoryService {
  private queries: ReturnType<typeof createMemoryQuery>
  private dedupThreshold: number = DEFAULT_DEDUP_THRESHOLD
  private embeddingService: EmbeddingService
  private provider: EmbeddingProvider
  private cache: CacheService
  private vec: VecService
  private db: Database
  private logger?: Logger

  constructor(deps: MemoryServiceDeps) {
    this.db = deps.db
    this.provider = deps.provider ?? createNoopEmbeddingProvider()
    this.embeddingService = deps.embeddingService
    this.cache = deps.cache
    this.vec = deps.vec ?? createNoopVecService()
    this.logger = deps.logger
    this.queries = createMemoryQuery(this.db, this.vec, deps.logger)
  }

  setDedupThreshold(threshold: number): void {
    this.dedupThreshold = Math.max(0.05, Math.min(0.40, threshold))
  }

  setVecService(vec: VecService): void {
    this.vec = vec
    this.queries = createMemoryQuery(this.db, this.vec, this.logger)
  }

  async create(input: CreateMemoryInput): Promise<{ id: number; deduplicated: boolean }> {
    const existingMemory = this.queries.getByContent(input.projectId, input.content)
    if (existingMemory) {
      return { id: existingMemory.id, deduplicated: true }
    }

    const embedding = await this.embeddingService.embedText(input.content)
    const similar = await this.queries.findSimilar(embedding, input.projectId, this.dedupThreshold, 1)
    if (similar.length > 0) {
      return { id: similar[0]!.id, deduplicated: true }
    }

    try {
      this.db.exec('BEGIN IMMEDIATE')
      const duplicateCheck = this.queries.getByContent(input.projectId, input.content)
      if (duplicateCheck) {
        this.db.exec('COMMIT')
        return { id: duplicateCheck.id, deduplicated: true }
      }

      const memoryId = this.queries.createInDb(input)
      this.db.exec('COMMIT')

      if (this.vec.available && embedding.length > 0) {
        try {
          await this.vec.insert(embedding, memoryId, input.projectId)
        } catch (error) {
          this.queries.logError?.('Failed to insert embedding for memory', error)
        }
      }

      await this.invalidateCache(input.projectId)
      return { id: memoryId, deduplicated: false }
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Ignore rollback errors
      }
      throw error
    }
  }

  async update(id: number, input: UpdateMemoryInput): Promise<void> {
    const existing = this.queries.getById(id)
    if (!existing) {
      throw new Error(`Memory ${id} not found`)
    }

    this.queries.update(id, input)

    if (input.content !== undefined) {
      const embedding = await this.embeddingService.embedText(input.content)
      await this.queries.updateEmbedding(id, embedding)
    }

    await this.invalidateCache(existing.projectId)
  }

  async delete(id: number): Promise<void> {
    const existing = this.queries.getById(id)
    if (!existing) {
      throw new Error(`Memory ${id} not found`)
    }

    await this.queries.delete(id)
    await this.invalidateCache(existing.projectId)
  }

  getById(id: number): Memory | undefined {
    const memory = this.queries.getById(id)
    if (memory) {
      this.queries.trackAccess(id)
    }
    return memory
  }

  listByProject(
    projectId: string,
    filters?: {
      scope?: MemoryScope
      limit?: number
      offset?: number
    }
  ): Memory[] {
    const memories = this.queries.listByProject(projectId, filters)
    memories.forEach((m: Memory) => this.queries.trackAccess(m.id))
    return memories
  }

  listAll(
    filters?: {
      projectId?: string
      scope?: MemoryScope
      limit?: number
      offset?: number
    }
  ): Memory[] {
    const memories = this.queries.listAll(filters)
    memories.forEach((m: Memory) => this.queries.trackAccess(m.id))
    return memories
  }

  async search(
    query: string,
    projectId?: string,
    filters?: {
      scope?: MemoryScope
      limit?: number
    }
  ): Promise<MemorySearchResult[]> {
    const embedding = await this.embeddingService.embedText(query)
    const results = await this.queries.search(embedding, projectId, filters)
    results.forEach((r) => this.queries.trackAccess(r.memory.id))
    return results
  }

  getStats(projectId: string): MemoryStats {
    const stats = this.queries.getStats(projectId)
    return {
      projectId,
      total: stats.total,
      byScope: stats.byScope,
    }
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.queries.deleteByProject(projectId)
    await this.invalidateCache(projectId)
  }

  async deleteByFilePath(projectId: string, filePath: string): Promise<void> {
    await this.queries.deleteByFilePath(projectId, filePath)
    await this.invalidateCache(projectId)
  }

  countByProject(projectId: string): number {
    return this.queries.countByProject(projectId)
  }

  getMemoriesWithoutEmbeddings(projectId?: string, limit: number = 50): Memory[] {
    return this.queries.getMemoriesWithoutEmbeddings(projectId, limit)
  }

  countMemoriesWithoutEmbeddings(projectId?: string): number {
    return this.queries.countMemoriesWithoutEmbeddings(projectId)
  }

  async embedMemory(memoryId: number, content: string): Promise<boolean> {
    try {
      const embedding = await this.embeddingService.embedText(content)
      if (embedding.length > 0) {
        await this.queries.updateEmbedding(memoryId, embedding)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async reindex(projectId?: string): Promise<{ total: number; success: number; failed: number }> {
    const allMemories = projectId
      ? this.queries.listByProject(projectId, { limit: 10000 })
      : this.queries.listAll({ limit: 10000 })

    let success = 0
    let failed = 0
    const batchSize = 50

    for (let i = 0; i < allMemories.length; i += batchSize) {
      const batch = allMemories.slice(i, i + batchSize)
      const texts = batch.map(m => m.content)

      try {
        const embeddings = await this.embeddingService.embedTexts(texts)

        for (let j = 0; j < batch.length; j++) {
          try {
            await this.queries.updateEmbedding(batch[j]!.id, embeddings[j]!)
            success++
          } catch {
            failed++
          }
        }
      } catch {
        failed += batch.length
      }
    }

    if (projectId) {
      await this.invalidateCache(projectId)
    } else {
      await this.invalidateCache('*')
    }

    return { total: allMemories.length, success, failed }
  }

  private async invalidateCache(projectId: string): Promise<void> {
    try {
      await this.cache.invalidatePattern(`mem:project:${projectId}:*`)
    } catch {
      // Silent failure
    }
  }

  async destroy(): Promise<void> {
    this.vec.dispose()
    this.cache.destroy()
    if (this.provider.dispose) {
      await this.provider.dispose()
    }
  }
}

export interface CreateMemoryServiceOptions {
  db: Database
  provider: EmbeddingProvider
  vec: VecService
  logger?: Logger
}

export async function createMemoryService(options: CreateMemoryServiceOptions): Promise<MemoryService> {
  const cache = createCacheService()
  const embeddingService = createEmbeddingService(options.provider, cache)

  return new MemoryService({
    db: options.db,
    provider: options.provider,
    embeddingService,
    cache,
    vec: options.vec,
    logger: options.logger,
  })
}
