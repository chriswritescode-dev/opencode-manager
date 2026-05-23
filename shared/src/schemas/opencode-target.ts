import { z } from 'zod'

export const OpenCodeTargetStateSchema = z.enum([
  'missing',
  'starting',
  'healthy',
  'unhealthy',
  'failed',
  'stopped',
])

export const OpenCodeTargetSchema = z.object({
  repoId: z.number(),
  state: OpenCodeTargetStateSchema,
  openCodeUrl: z.string().optional(),
  token: z.string().optional(),
  startedAt: z.number().optional(),
  lastUsedAt: z.number().optional(),
  lastError: z.string().optional(),
  reused: z.boolean(),
})

export const EnsureOpenCodeTargetRequestSchema = z.object({
  workspaceId: z.string().optional(),
  clientId: z.string().optional(),
})

export const EnsureOpenCodeTargetResponseSchema = z.object({
  repoId: z.number(),
  state: OpenCodeTargetStateSchema,
  openCodeUrl: z.string(),
  headers: z.record(z.string(), z.string()),
  reused: z.boolean(),
})

export const SyncRepoSessionRequestSchema = z.object({
  sessionId: z.string(),
  reason: z.enum(['idle', 'completed', 'stop', 'manual']),
})

export const SyncRepoSessionResponseSchema = z.object({
  repoId: z.number(),
  sessionId: z.string(),
  replayedEvents: z.number(),
})
