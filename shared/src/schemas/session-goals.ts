import { z } from "zod";
import { SESSION_PROMPT_MAX_LENGTH, GOAL_MAX_CONTINUATIONS_MIN, GOAL_MAX_CONTINUATIONS_MAX } from "./limits";

export const SessionGoalStatusSchema = z.enum(["active", "paused", "completed", "blocked", "stopped"]);

export type SessionGoalStatus = z.infer<typeof SessionGoalStatusSchema>;

export const SessionGoalStopReasonSchema = z.enum([
  "cancelled",
  "user_paused",
  "continuation_limit",
  "token_budget",
  "turn_error",
  "interrupted",
  "audit_failed",
  "session_deleted",
]);

export type SessionGoalStopReason = z.infer<typeof SessionGoalStopReasonSchema>;

export const SessionGoalVerdictSchema = z.enum(["continue", "done", "blocked"]);

export type SessionGoalVerdict = z.infer<typeof SessionGoalVerdictSchema>;

export const SessionGoalTurnStateSchema = z.enum(["waiting", "running"]);

export type SessionGoalTurnState = z.infer<typeof SessionGoalTurnStateSchema>;

export const SessionGoalSchema = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  directory: z.string(),
  objective: z.string(),
  status: SessionGoalStatusSchema,
  stopReason: SessionGoalStopReasonSchema.nullable(),
  turnState: SessionGoalTurnStateSchema,
  continuationCount: z.number().int(),
  maxContinuations: z.number().int(),
  tokenBudget: z.number().int().nullable(),
  tokensUsed: z.number().int(),
  consecutiveBlocked: z.number().int(),
  lastVerdict: SessionGoalVerdictSchema.nullable(),
  lastReason: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  finishedAt: z.number().nullable(),
});

export type SessionGoal = z.infer<typeof SessionGoalSchema>;

export const SESSION_GOAL_POLL_INTERVAL_MS = 3000;

export type OpenSessionGoal = SessionGoal & { status: "active" | "paused" };

export type TerminalSessionGoal = SessionGoal & { status: "completed" | "blocked" | "stopped" };

/** True while the goal still drives its session: active or paused. */
export function isOpenSessionGoal(goal: SessionGoal | null | undefined): goal is OpenSessionGoal {
  return goal?.status === "active" || goal?.status === "paused";
}

/** True once the goal has finished: completed, blocked or stopped. */
export function isTerminalSessionGoal(goal: SessionGoal | null | undefined): goal is TerminalSessionGoal {
  return goal?.status === "completed" || goal?.status === "blocked" || goal?.status === "stopped";
}

export const StartSessionGoalRequestSchema = z.object({
  sessionId: z.string().min(1),
  directory: z.string().min(1),
  objective: z.string().trim().min(1).max(SESSION_PROMPT_MAX_LENGTH),
  maxContinuations: z.number().int().min(GOAL_MAX_CONTINUATIONS_MIN).max(GOAL_MAX_CONTINUATIONS_MAX).optional(),
  tokenBudget: z.number().int().positive().optional(),
});

export type StartSessionGoalRequest = z.infer<typeof StartSessionGoalRequestSchema>;
