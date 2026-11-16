import { z } from "zod";

export const SessionSandboxCpusSchema = z.number().int().min(1).max(64);

export const SessionSandboxMemoryMibSchema = z.number().int().min(1024).max(1048576);

export const SessionSandboxResourcesSchema = z.object({
  cpus: SessionSandboxCpusSchema,
  memoryMib: SessionSandboxMemoryMibSchema,
});

export type SessionSandboxResources = z.infer<typeof SessionSandboxResourcesSchema>;

export const RepoSandboxResourcesSchema = z.object({
  override: SessionSandboxResourcesSchema.nullable(),
  effective: SessionSandboxResourcesSchema,
  running: SessionSandboxResourcesSchema.nullable(),
});
export type RepoSandboxResources = z.infer<typeof RepoSandboxResourcesSchema>;

export const SessionSandboxSourceSchema = z.enum(['default', 'user']);

export type SessionSandboxSource = z.infer<typeof SessionSandboxSourceSchema>;

export const SetSessionSandboxRequestSchema = z.object({
  sandboxed: z.boolean(),
});

export type SetSessionSandboxRequest = z.infer<typeof SetSessionSandboxRequestSchema>;

export const SessionSandboxStateSchema = z.object({
  sessionId: z.string(),
  rootSessionId: z.string(),
  sandboxed: z.boolean(),
  source: SessionSandboxSourceSchema,
  lockedReason: z.enum(["child"]).nullable(),
  available: z.boolean(),
});

export type SessionSandboxState = z.infer<typeof SessionSandboxStateSchema>;

export const SessionSandboxClaimSchema = z.object({ sandboxed: z.boolean() });

export type SessionSandboxClaim = z.infer<typeof SessionSandboxClaimSchema>;
