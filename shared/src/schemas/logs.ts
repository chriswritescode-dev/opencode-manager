import { z } from 'zod'

export const MANAGER_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export const MANAGER_LOG_SOURCES = ['manager', 'opencode'] as const

export const ManagerLogLevelSchema = z.enum(MANAGER_LOG_LEVELS)
export const ManagerLogSourceSchema = z.enum(MANAGER_LOG_SOURCES)

export const ManagerLogEntrySchema = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  level: ManagerLogLevelSchema,
  source: ManagerLogSourceSchema,
  message: z.string(),
})

export const ManagerLogQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().optional(),
  level: ManagerLogLevelSchema.optional(),
  source: ManagerLogSourceSchema.optional(),
})

export const ManagerLogsResponseSchema = z.object({
  entries: z.array(ManagerLogEntrySchema),
  instanceId: z.string().min(1),
  latestSeq: z.number().int().nonnegative(),
  oldestSeq: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
})

export type ManagerLogLevel = z.infer<typeof ManagerLogLevelSchema>
export type ManagerLogSource = z.infer<typeof ManagerLogSourceSchema>
export type ManagerLogEntry = z.infer<typeof ManagerLogEntrySchema>
export type ManagerLogQuery = z.infer<typeof ManagerLogQuerySchema>
export type ManagerLogsResponse = z.infer<typeof ManagerLogsResponseSchema>
