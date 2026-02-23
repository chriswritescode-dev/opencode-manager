import type { MemoryService } from './memory'
import type { Logger } from '../types'

export interface EmbeddingSyncOptions {
  batchSize?: number
  maxRetries?: number
}

export interface EmbeddingSyncResult {
  total: number
  embedded: number
  failed: number
}

export class EmbeddingSyncService {
  private memoryService: MemoryService
  private logger?: Logger
  private batchSize: number
  private maxRetries: number
  private syncInProgress: boolean = false
  private static readonly MAX_ITERATIONS = 100

  constructor(memoryService: MemoryService, logger?: Logger, options: EmbeddingSyncOptions = {}) {
    this.memoryService = memoryService
    this.logger = logger
    this.batchSize = options.batchSize ?? 50
    this.maxRetries = options.maxRetries ?? 3
  }

  async start(): Promise<void> {
    this.logger?.log('[embedding-sync] Starting initial sync...')
    await this.syncAll()
  }

  async syncAll(): Promise<EmbeddingSyncResult> {
    if (this.syncInProgress) {
      this.logger?.log('[embedding-sync] Sync already in progress, skipping')
      return { total: 0, embedded: 0, failed: 0 }
    }

    this.syncInProgress = true
    let total = 0
    let embedded = 0
    let failed = 0

    try {
      let pending = this.memoryService.countMemoriesWithoutEmbeddings()
      let iterations = 0

      while (pending > 0 && iterations < EmbeddingSyncService.MAX_ITERATIONS) {
        iterations++
        const memories = this.memoryService.getMemoriesWithoutEmbeddings(undefined, this.batchSize)
        let batchSuccess = 0
        let batchFailed = 0

          for (const memory of memories) {
            let success = false
            let attempts = 0

            while (!success && attempts < this.maxRetries) {
              success = await this.memoryService.embedMemory(memory.id, memory.content)
              attempts++

              if (!success && attempts < this.maxRetries) {
                this.logger?.log(`[embedding-sync] Retrying memory ${memory.id} (attempt ${attempts + 1}/${this.maxRetries})`)
              }
            }

            total++

            if (success) {
              embedded++
              batchSuccess++
            } else {
              failed++
              batchFailed++
              this.logger?.error(`[embedding-sync] Failed to embed memory ${memory.id} after ${this.maxRetries} attempts`)
            }
          }

        if (batchSuccess === 0 && batchFailed > 0) {
          this.logger?.error('[embedding-sync] No memories embedded in this batch, stopping to prevent infinite loop')
          break
        }

        pending = this.memoryService.countMemoriesWithoutEmbeddings()

        if (pending > 0) {
          this.logger?.log(`[embedding-sync] Progress: ${embedded} embedded, ${failed} failed, ${pending} remaining`)
        }
      }

      if (iterations >= EmbeddingSyncService.MAX_ITERATIONS) {
        this.logger?.error('[embedding-sync] Reached max iterations, stopping sync')
      }

      this.logger?.log(`[embedding-sync] Complete: ${embedded} embedded, ${failed} failed`)
    } catch (error) {
      this.logger?.error('[embedding-sync] Sync error', error)
    } finally {
      this.syncInProgress = false
    }

    return { total, embedded, failed }
  }

  async syncProject(projectId: string): Promise<EmbeddingSyncResult> {
    let total = 0
    let embedded = 0
    let failed = 0

    try {
      let pending = this.memoryService.countMemoriesWithoutEmbeddings(projectId)
      let iterations = 0

      while (pending > 0 && iterations < EmbeddingSyncService.MAX_ITERATIONS) {
        iterations++
        const memories = this.memoryService.getMemoriesWithoutEmbeddings(projectId, this.batchSize)
        let batchSuccess = 0
        let batchFailed = 0

        for (const memory of memories) {
          let success = false
          let attempts = 0

          while (!success && attempts < this.maxRetries) {
            success = await this.memoryService.embedMemory(memory.id, memory.content)
            attempts++

            if (!success && attempts < this.maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          }

          total++

          if (success) {
            embedded++
            batchSuccess++
          } else {
            failed++
            batchFailed++
          }
        }

        if (batchSuccess === 0 && batchFailed > 0) {
          this.logger?.error('[embedding-sync] No memories embedded in this batch, stopping to prevent infinite loop')
          break
        }

        pending = this.memoryService.countMemoriesWithoutEmbeddings(projectId)
      }

      if (iterations >= EmbeddingSyncService.MAX_ITERATIONS) {
        this.logger?.error('[embedding-sync] Reached max iterations, stopping sync')
      }
    } catch (error) {
      this.logger?.error(`[embedding-sync] Sync error for project ${projectId}`, error)
    }

    return { total, embedded, failed }
  }

  isSyncInProgress(): boolean {
    return this.syncInProgress
  }
}

export function createEmbeddingSyncService(
  memoryService: MemoryService,
  logger?: Logger,
  options?: EmbeddingSyncOptions
): EmbeddingSyncService {
  return new EmbeddingSyncService(memoryService, logger, options)
}
