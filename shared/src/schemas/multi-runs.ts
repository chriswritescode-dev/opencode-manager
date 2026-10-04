import { z } from "zod";
import { SESSION_PROMPT_MAX_LENGTH } from "./limits";

export const MULTI_RUN_MAX_MODELS = 5;

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

export const MultiRunSchema = z.object({
  id: z.number().int(),
  repoId: z.number().int(),
  name: z.string(),
  prompt: z.string(),
  isolated: z.boolean(),
  baseRef: z.string().nullable(),
  createdAt: z.number(),
  entries: z.array(MultiRunEntrySchema),
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
