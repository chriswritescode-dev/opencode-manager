import { z } from "zod";

export const SessionSandboxResourcesSchema = z.object({
  cpus: z.number().int().min(1).max(64),
  memoryMib: z.number().int().min(1024).max(1048576),
});

export type SessionSandboxResources = z.infer<typeof SessionSandboxResourcesSchema>;

export const SessionSandboxSourceSchema = z.enum(['default', 'user']);

export type SessionSandboxSource = z.infer<typeof SessionSandboxSourceSchema>;

export const SetSessionSandboxRequestSchema = z
  .object({
    sandboxed: z.boolean().optional(),
    resources: SessionSandboxResourcesSchema.nullable().optional(),
  })
  .refine((value) => value.sandboxed !== undefined || value.resources !== undefined, {
    message: 'At least one of sandboxed or resources is required',
  });

export type SetSessionSandboxRequest = z.infer<typeof SetSessionSandboxRequestSchema>;

export const SessionSandboxStateSchema = z.object({
  sessionId: z.string(),
  rootSessionId: z.string(),
  sandboxed: z.boolean(),
  source: SessionSandboxSourceSchema,
  resources: SessionSandboxResourcesSchema.nullable(),
  effectiveResources: SessionSandboxResourcesSchema,
  lockedReason: z.enum(["child"]).nullable(),
  available: z.boolean(),
});

export type SessionSandboxState = z.infer<typeof SessionSandboxStateSchema>;

export const SessionSandboxClaimSchema = z.object({
  sandboxed: z.boolean(),
  source: SessionSandboxSourceSchema,
  since: z.number(),
});

export type SessionSandboxClaim = z.infer<typeof SessionSandboxClaimSchema>;
