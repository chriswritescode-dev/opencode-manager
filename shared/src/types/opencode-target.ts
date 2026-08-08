import { z } from 'zod'
import {
  OpenCodeTargetStateSchema,
  OpenCodeTargetSchema,
  EnsureOpenCodeTargetRequestSchema,
  EnsureOpenCodeTargetResponseSchema,
  SyncRepoSessionRequestSchema,
  SyncRepoSessionResponseSchema,
} from '../schemas/opencode-target'

export type OpenCodeTargetState = z.infer<typeof OpenCodeTargetStateSchema>
export type OpenCodeTarget = z.infer<typeof OpenCodeTargetSchema>
export type EnsureOpenCodeTargetRequest = z.infer<typeof EnsureOpenCodeTargetRequestSchema>
export type EnsureOpenCodeTargetResponse = z.infer<typeof EnsureOpenCodeTargetResponseSchema>
export type SyncRepoSessionRequest = z.infer<typeof SyncRepoSessionRequestSchema>
export type SyncRepoSessionResponse = z.infer<typeof SyncRepoSessionResponseSchema>
