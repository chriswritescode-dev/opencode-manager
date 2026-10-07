import { z } from "zod";
import { FUSION_INSTRUCTIONS_MAX_LENGTH, SESSION_PROMPT_MAX_LENGTH } from "./limits";

export const MULTI_RUN_MAX_MODELS = 5;
export const MULTI_RUN_FUSION_MIN_SOURCES = 2;

export const MultiRunEntryStatusSchema = z.enum(["starting", "started", "failed", "discarded"]);

export type MultiRunEntryStatus = z.infer<typeof MultiRunEntryStatusSchema>;

export const MultiRunEntrySchema = z.object({
  id: z.number().int(),
  model: z.string(),
  status: MultiRunEntryStatusSchema,
  sessionId: z.string().nullable(),
  directory: z.string().nullable(),
  isolated: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type MultiRunEntry = z.infer<typeof MultiRunEntrySchema>;

export const MultiRunFusionStatusSchema = z.enum(["starting", "started", "failed"]);

export type MultiRunFusionStatus = z.infer<typeof MultiRunFusionStatusSchema>;

export const MultiRunFusionSourceSchema = z.object({
  entryId: z.number().int(),
  sessionId: z.string(),
  model: z.string(),
  truncated: z.boolean(),
});

export type MultiRunFusionSource = z.infer<typeof MultiRunFusionSourceSchema>;

export const MultiRunFusionSchema = z.object({
  id: z.number().int(),
  requestId: z.string(),
  model: z.string(),
  instructions: z.string().nullable(),
  isolated: z.boolean(),
  baseRef: z.string().nullable(),
  status: MultiRunFusionStatusSchema,
  sessionId: z.string().nullable(),
  directory: z.string().nullable(),
  error: z.string().nullable(),
  sources: z.array(MultiRunFusionSourceSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type MultiRunFusion = z.infer<typeof MultiRunFusionSchema>;

export const MultiRunSchema = z.object({
  id: z.number().int(),
  repoId: z.number().int(),
  name: z.string(),
  prompt: z.string(),
  isolated: z.boolean(),
  baseRef: z.string().nullable(),
  createdAt: z.number(),
  entries: z.array(MultiRunEntrySchema),
  fusions: z.array(MultiRunFusionSchema),
});

export type MultiRun = z.infer<typeof MultiRunSchema>;

export const LaunchMultiRunRequestSchema = z.object({
  repoId: z.number().int(),
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(SESSION_PROMPT_MAX_LENGTH),
  models: z
    .array(z.string().min(3))
    .min(1)
    .max(MULTI_RUN_MAX_MODELS)
    .refine((models) => new Set(models).size === models.length, { message: "Models must be unique" }),
  isolate: z.boolean(),
  baseRef: z.string().trim().min(1).optional(),
  agent: z.string().optional(),
});

export type LaunchMultiRunRequest = z.infer<typeof LaunchMultiRunRequestSchema>;

export const FuseMultiRunRequestSchema = z.object({
  requestId: z.string().uuid(),
  entryIds: z
    .array(z.number().int())
    .min(MULTI_RUN_FUSION_MIN_SOURCES)
    .max(MULTI_RUN_MAX_MODELS)
    .refine((entryIds) => new Set(entryIds).size === entryIds.length, { message: "Entry ids must be unique" }),
  model: z.string().min(3),
  instructions: z.string().trim().max(FUSION_INSTRUCTIONS_MAX_LENGTH).optional(),
  baseRef: z.string().trim().min(1).optional(),
  agent: z.string().optional(),
});

export type FuseMultiRunRequest = z.infer<typeof FuseMultiRunRequestSchema>;

export const FusionUnavailableReasonSchema = z.enum([
  "not-started",
  "running",
  "incomplete",
  "failed",
  "missing",
  "unavailable",
]);

export type FusionUnavailableReason = z.infer<typeof FusionUnavailableReasonSchema>;

export const FusionUnavailableSourceSchema = z.object({
  entryId: z.number().int(),
  model: z.string(),
  reason: FusionUnavailableReasonSchema,
  message: z.string(),
});

export type FusionUnavailableSource = z.infer<typeof FusionUnavailableSourceSchema>;

export const FusionUnavailableDetailsSchema = z.object({
  unavailableSources: z.array(FusionUnavailableSourceSchema),
});

export type FusionUnavailableDetails = z.infer<typeof FusionUnavailableDetailsSchema>;

export const FusionRecoveredDetailsSchema = z.object({
  fusions: z.array(z.object({ fusionId: z.number().int(), sessionId: z.string() })),
});

export type FusionRecoveredDetails = z.infer<typeof FusionRecoveredDetailsSchema>;
