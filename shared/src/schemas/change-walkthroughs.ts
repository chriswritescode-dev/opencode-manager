import { z } from "zod";

export const WALKTHROUGH_DIFF_MAX_CHARS = 60000;
export const WALKTHROUGH_HUNK_MAX_CHARS = 8000;
export const WALKTHROUGH_MAX_STOPS = 20;
export const WALKTHROUGH_TEXT_MAX_CHARS = 2000;

export const WalkthroughHunkSchema = z.object({
  id: z.string(),
  file: z.string(),
  status: z.enum(["added", "deleted", "modified"]),
  header: z.string(),
  text: z.string(),
  truncated: z.boolean(),
});

export type WalkthroughHunk = z.infer<typeof WalkthroughHunkSchema>;

export const WalkthroughStopSchema = z.object({
  id: z.string(),
  title: z.string(),
  explanation: z.string(),
  hunkIds: z.array(z.string()),
  status: z.enum(["pending", "ready", "failed"]),
  explanationKey: z.string().nullable(),
});

export type WalkthroughStop = z.infer<typeof WalkthroughStopSchema>;

export type WalkthroughStopStatus = WalkthroughStop["status"];

export const WalkthroughOmittedFileSchema = z.object({
  file: z.string(),
  reason: z.enum(["binary", "budget"]),
});

export type WalkthroughOmittedFile = z.infer<typeof WalkthroughOmittedFileSchema>;

export const ChangeWalkthroughSchema = z.object({
  sessionId: z.string(),
  diffHash: z.string(),
  summary: z.string(),
  stops: z.array(WalkthroughStopSchema),
  hunks: z.array(WalkthroughHunkSchema),
  omittedFiles: z.array(WalkthroughOmittedFileSchema),
  createdAt: z.number(),
});

export type ChangeWalkthrough = z.infer<typeof ChangeWalkthroughSchema>;

export const WalkthroughGenerationErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export type WalkthroughGenerationError = z.infer<typeof WalkthroughGenerationErrorSchema>;

export const ChangeWalkthroughStateSchema = z.object({
  walkthrough: ChangeWalkthroughSchema.nullable(),
  currentDiffHash: z.string().nullable(),
  stale: z.boolean(),
  generating: z.boolean(),
  error: WalkthroughGenerationErrorSchema.nullable(),
});

export type ChangeWalkthroughState = z.infer<typeof ChangeWalkthroughStateSchema>;

export const GenerateChangeWalkthroughRequestSchema = z.object({
  regenerate: z.boolean().optional(),
});

export type GenerateChangeWalkthroughRequest = z.infer<typeof GenerateChangeWalkthroughRequestSchema>;
