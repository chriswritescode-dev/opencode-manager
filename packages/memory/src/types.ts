export type MemoryScope = 'convention' | 'decision' | 'context'

export interface Memory {
  id: number
  projectId: string
  scope: MemoryScope
  content: string
  filePath: string | null
  accessCount: number
  lastAccessedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreateMemoryInput {
  projectId: string
  scope: MemoryScope
  content: string
  filePath?: string
}

export interface UpdateMemoryInput {
  content?: string
  scope?: MemoryScope
}

export interface MemorySearchResult {
  memory: Memory
  distance: number
}

export interface MemoryStats {
  projectId: string
  total: number
  byScope: Record<MemoryScope, number>
}

export type EmbeddingProviderType = 'openai' | 'voyage' | 'local'

export interface EmbeddingConfig {
  provider: EmbeddingProviderType
  model: string
  dimensions?: number
  baseUrl?: string
  apiKey?: string
  dataDir?: string
  serverGracePeriod?: number
}

export interface LoggingConfig {
  enabled: boolean
  file: string
}

export interface Logger {
  log: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export interface PluginConfig {
  dataDir?: string
  embedding: EmbeddingConfig
  dedupThreshold?: number
  logging?: LoggingConfig
  compaction?: CompactionConfig
}

export interface ListMemoriesFilter {
  scope?: MemoryScope
  limit?: number
  offset?: number
}

export interface SessionState {
  key: string
  projectId: string
  data: unknown
  expiresAt: number | null
  createdAt: number
  updatedAt: number
}

export interface PlanningState {
  objective?: string
  current?: string
  next?: string
  phases?: Array<{ title: string; status: string; notes?: string }>
  findings?: string[]
  errors?: string[]
  active?: boolean
}

export interface PreCompactionSnapshot {
  timestamp: string
  sessionId: string
  planningState?: PlanningState
  branch?: string
  activeFiles?: string[]
}

export interface CompactionConfig {
  customPrompt?: boolean
  inlinePlanning?: boolean
  maxContextTokens?: number
  snapshotToKV?: boolean
}

export interface HealthStatus {
  dbStatus: 'ok' | 'error'
  memoryCount: number
  operational: boolean
  serverRunning: boolean
  serverHealth: { status: string; clients: number; uptime: number } | null
  configuredModel: { model: string; dimensions: number }
  currentModel: { model: string; dimensions: number } | null
  needsReindex: boolean
  overallStatus: 'ok' | 'degraded' | 'error'
}
