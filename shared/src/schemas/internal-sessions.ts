import { z } from "zod";
import { SESSION_PROMPT_MAX_LENGTH } from "./limits";

export const InternalCreateSessionRequestSchema = z
  .object({
    repoId: z.number().int(),
    prompt: z.string().trim().min(1).max(SESSION_PROMPT_MAX_LENGTH),
    title: z.string().max(200).optional(),
    model: z.string().optional(),
    agent: z.string().optional(),
    worktree: z.boolean().optional(),
    ref: z.string().optional(),
  })
  .strict();

export const InternalSessionPromptRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(SESSION_PROMPT_MAX_LENGTH),
  })
  .strict();

export const InternalForkSessionRequestSchema = z
  .object({
    beforeMessageId: z.string().optional(),
  })
  .strict();
