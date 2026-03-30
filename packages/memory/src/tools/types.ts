import { tool } from '@opencode-ai/plugin'
import type { Database } from 'bun:sqlite'
import type { PluginConfig, Logger, MemoryScope } from '../types'
import type { EmbeddingProvider } from '../embedding'
import type { VecService } from '../storage/vec-types'
import type { MemoryService } from '../services/memory'
import type { createKvService } from '../services/kv'
import type { createLoopService } from '../services/loop'
import type { createLoopEventHandler } from '../hooks'
import type { createMemoryInjectionHook } from '../hooks'
import type { createOpencodeClient as createV2Client } from '@opencode-ai/sdk/v2'
import type { PluginInput } from '@opencode-ai/plugin'

const z = tool.schema
export const scopeEnum = z.enum(['convention', 'decision', 'context']) as any

export interface DimensionMismatchState {
  detected: boolean
  expected: number | null
  actual: number | null
}

export interface InitState {
  vecReady: boolean
  syncRunning: boolean
  syncComplete: boolean
}

export interface ToolContext {
  projectId: string
  directory: string
  config: PluginConfig
  logger: Logger
  db: Database
  provider: EmbeddingProvider
  dataDir: string
  memoryService: MemoryService
  kvService: ReturnType<typeof createKvService>
  loopService: ReturnType<typeof createLoopService>
  loopHandler: ReturnType<typeof createLoopEventHandler>
  memoryInjection: ReturnType<typeof createMemoryInjectionHook>
  v2: ReturnType<typeof createV2Client>
  mismatchState: DimensionMismatchState
  initState: InitState
  getCurrentVec: () => VecService
  cleanup: () => Promise<void>
  input: PluginInput
}

export function withDimensionWarning(mismatchState: DimensionMismatchState, result: string): string {
  if (!mismatchState.detected) return result
  return `${result}\n\n---\nWarning: Embedding dimension mismatch detected (config: ${mismatchState.expected}d, database: ${mismatchState.actual}d). Semantic search is disabled.\n- If you changed your embedding model intentionally, run memory-health with action "reindex" to rebuild embeddings.\n- If this was accidental, revert your embedding config to match the existing model.`
}
