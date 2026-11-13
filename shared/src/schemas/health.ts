import { z } from 'zod'
import { OPENCODE_LIFECYCLE_STATES, OPENCODE_RECOVERY_ACTIONS } from '../opencode/lifecycle'

const openCodeLifecycleStatusSchema = z.object({
  state: z.enum(OPENCODE_LIFECYCLE_STATES),
  healthy: z.boolean(),
  port: z.number(),
  version: z.string().nullable(),
  minVersion: z.string(),
  versionSupported: z.boolean(),
  lastError: z.string().nullable(),
  activeRecoveryAction: z.enum(OPENCODE_RECOVERY_ACTIONS).nullable(),
  attemptedRecoveryActions: z.array(z.enum(OPENCODE_RECOVERY_ACTIONS)),
  nextRecoveryAction: z.enum(OPENCODE_RECOVERY_ACTIONS).nullable(),
  failureCount: z.number(),
  watching: z.boolean(),
  updatedAt: z.string(),
})

const healthSandboxStatusSchema = z.object({
  available: z.boolean(),
  enabled: z.boolean(),
  enforced: z.boolean(),
  reason: z.string().optional(),
  msbVersion: z.string().optional(),
})

export const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  database: z.enum(['connected', 'disconnected']),
  opencode: z.enum(['healthy', 'unhealthy']),
  opencodePort: z.number(),
  opencodeVersion: z.string().nullable(),
  opencodeMinVersion: z.string(),
  opencodeVersionSupported: z.boolean(),
  opencodeManagerVersion: z.string().nullable(),
  opencodeRestartPending: z.boolean().optional(),
  opencodeLifecycle: openCodeLifecycleStatusSchema.optional(),
  sandbox: healthSandboxStatusSchema.optional(),
  error: z.string().optional(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
