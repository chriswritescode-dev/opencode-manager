import { z } from "zod";
import { ChangeSourceSchema } from './change-sources'

export const WALKTHROUGH_GENERATION_TIMEOUT_MS = 15 * 60 * 1000;
export const WALKTHROUGH_REFINE_MAX_CHARS = 4000;

export const WalkthroughGenerationErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export type WalkthroughGenerationError = z.infer<typeof WalkthroughGenerationErrorSchema>;

export const WalkthroughStatusSchema = z.enum(['generating', 'ready', 'failed', 'cancelled'])

export type WalkthroughStatus = z.infer<typeof WalkthroughStatusSchema>

export const ChangeWalkthroughSchema = z.object({
  sessionId: z.string(),
  source: ChangeSourceSchema,
  diffHash: z.string(),
  walkthroughSessionId: z.string().nullable(),
  status: WalkthroughStatusSchema,
  artifactPath: z.string().nullable(),
  publishedAt: z.number().nullable(),
  executionStartedAt: z.number().nullable(),
  error: WalkthroughGenerationErrorSchema.nullable(),
  model: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type ChangeWalkthrough = z.infer<typeof ChangeWalkthroughSchema>;

export const ChangeWalkthroughStateSchema = z.object({
  walkthrough: ChangeWalkthroughSchema.nullable(),
  currentDiffHash: z.string().nullable(),
  hasChanges: z.boolean(),
  stale: z.boolean(),
  generating: z.boolean(),
  running: z.boolean(),
  error: WalkthroughGenerationErrorSchema.nullable(),
});

export type ChangeWalkthroughState = z.infer<typeof ChangeWalkthroughStateSchema>;

export const GenerateChangeWalkthroughRequestSchema = z.object({
  regenerate: z.boolean().optional(),
  source: ChangeSourceSchema.optional(),
  model: z.string().trim().min(1).max(512).optional(),
});

export type GenerateChangeWalkthroughRequest = z.infer<typeof GenerateChangeWalkthroughRequestSchema>;

export const RefineChangeWalkthroughRequestSchema = z.object({
  source: ChangeSourceSchema.optional(),
  text: z.string().trim().min(1).max(WALKTHROUGH_REFINE_MAX_CHARS),
})

export type RefineChangeWalkthroughRequest = z.infer<typeof RefineChangeWalkthroughRequestSchema>
