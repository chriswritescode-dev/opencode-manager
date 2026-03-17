import { z } from 'zod'

export const MemoryScopeSchema = z.enum(['convention', 'decision', 'context'])
export type MemoryScope = z.infer<typeof MemoryScopeSchema>

export const MemorySchema = z.object({
  id: z.number(),
  projectId: z.string(),
  scope: MemoryScopeSchema,
  content: z.string(),
  filePath: z.string().nullable(),
  accessCount: z.number().default(0),
  lastAccessedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Memory = z.infer<typeof MemorySchema>

export const CreateMemoryRequestSchema = z.object({
  projectId: z.string(),
  scope: MemoryScopeSchema,
  content: z.string().min(1).max(10000),
})
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequestSchema>

export const UpdateMemoryRequestSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  scope: MemoryScopeSchema.optional(),
})
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequestSchema>

export const MemoryStatsSchema = z.object({
  projectId: z.string(),
  total: z.number(),
  byScope: z.record(MemoryScopeSchema, z.number()),
})
export type MemoryStats = z.infer<typeof MemoryStatsSchema>

export const MemoryListQuerySchema = z.object({
  projectId: z.string().optional(),
  scope: MemoryScopeSchema.optional(),
  content: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
})
export type MemoryListQuery = z.infer<typeof MemoryListQuerySchema>

export const EmbeddingProviderTypeSchema = z.enum(['openai', 'voyage', 'local'])
export type EmbeddingProviderType = z.infer<typeof EmbeddingProviderTypeSchema>

export const EmbeddingConfigSchema = z.object({
  provider: EmbeddingProviderTypeSchema,
  model: z.string(),
  dimensions: z.number().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
})
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>

export const LoggingConfigSchema = z.object({
  enabled: z.boolean(),
  file: z.string().optional(),
  debug: z.boolean().optional(),
})
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>

export const CompactionConfigSchema = z.object({
  customPrompt: z.boolean().optional(),
  maxContextTokens: z.number().optional(),
})
export type CompactionConfig = z.infer<typeof CompactionConfigSchema>

export const MemoryInjectionConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxResults: z.number().optional(),
  distanceThreshold: z.number().optional(),
  maxTokens: z.number().optional(),
  cacheTtlMs: z.number().optional(),
  debug: z.boolean().optional(),
})
export type MemoryInjectionConfig = z.infer<typeof MemoryInjectionConfigSchema>

export const MessagesTransformConfigSchema = z.object({
  enabled: z.boolean().optional(),
  debug: z.boolean().optional(),
})
export type MessagesTransformConfig = z.infer<typeof MessagesTransformConfigSchema>

export const RalphConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultMaxIterations: z.number().optional(),
  cleanupWorktree: z.boolean().optional(),
  defaultAudit: z.boolean().optional(),
  model: z.string().optional(),
  minCleanAudits: z.number().optional(),
  stallTimeoutMs: z.number().optional(),
})
export type RalphConfig = z.infer<typeof RalphConfigSchema>

export const PluginConfigSchema = z.object({
  dataDir: z.string().optional(),
  embedding: EmbeddingConfigSchema,
  dedupThreshold: z.number().min(0).max(1).default(0.25),
  logging: LoggingConfigSchema.optional(),
  compaction: CompactionConfigSchema.optional(),
  memoryInjection: MemoryInjectionConfigSchema.optional(),
  messagesTransform: MessagesTransformConfigSchema.optional(),
  executionModel: z.string().optional(),
  auditorModel: z.string().optional(),
  ralph: RalphConfigSchema.optional(),
})
export type PluginConfig = z.infer<typeof PluginConfigSchema>

export const KvEntrySchema = z.object({
  key: z.string(),
  data: z.unknown(),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number(),
})
export type KvEntry = z.infer<typeof KvEntrySchema>

export const KvListQuerySchema = z.object({
  projectId: z.string(),
  prefix: z.string().optional(),
})
export type KvListQuery = z.infer<typeof KvListQuerySchema>

export const CreateKvEntryRequestSchema = z.object({
  projectId: z.string(),
  key: z.string(),
  data: z.unknown(),
  ttlMs: z.number().optional(),
})
export type CreateKvEntryRequest = z.infer<typeof CreateKvEntryRequestSchema>

export const UpdateKvEntryRequestSchema = z.object({
  data: z.unknown(),
  ttlMs: z.number().optional(),
})
export type UpdateKvEntryRequest = z.infer<typeof UpdateKvEntryRequestSchema>
