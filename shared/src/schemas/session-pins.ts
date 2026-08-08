import { z } from "zod";

export const SessionPinSchema = z.object({
  sessionId: z.string(),
  directory: z.string(),
  pinnedAt: z.number(),
});

export const ToggleSessionPinRequestSchema = z.object({
  sessionId: z.string().min(1),
  directory: z.string().min(1),
  pinned: z.boolean(),
});

export type SessionPin = z.infer<typeof SessionPinSchema>;
export type ToggleSessionPinRequest = z.infer<typeof ToggleSessionPinRequestSchema>;
