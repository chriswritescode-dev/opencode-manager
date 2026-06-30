import { z } from 'zod'

export const ScheduleRunTriggerSourceSchema = z.enum(['manual', 'schedule'])
export type ScheduleRunTriggerSource = z.infer<typeof ScheduleRunTriggerSourceSchema>

export const ScheduleRunStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled'])
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>

export const ScheduleModeSchema = z.enum(['interval', 'cron'])
export type ScheduleMode = z.infer<typeof ScheduleModeSchema>

export const ScheduleSkillMetadataSchema = z.object({
  skillSlugs: z.array(z.string().min(1).max(100)).default([]),
  notes: z.string().max(2000).optional(),
})
export type ScheduleSkillMetadata = z.infer<typeof ScheduleSkillMetadataSchema>

/**
 * Bash commands whose blast radius escapes the throwaway worktree: host-level
 * commands that damage the machine regardless of cwd, plus force-pushes that can
 * overwrite remote branches. File-mutating commands (`rm -rf`, `git reset --hard`,
 * etc.) are intentionally omitted — they only affect the disposable worktree, which
 * is never auto-pushed and is the real safety boundary.
 */
export const DEFAULT_DESTRUCTIVE_BASH_PATTERNS = [
  'git push --force*', 'git push -f *',
  'sudo *', 'dd *', 'mkfs*',
  'shutdown*', 'reboot*', 'halt*',
  'kill -9 *', 'killall *',
] as const

export const SchedulePermissionConfigSchema = z.object({
  allowExternalDirectory: z.boolean().default(false),
  bashDenyPatterns: z.array(z.string().min(1).max(200)).max(200)
    .default([...DEFAULT_DESTRUCTIVE_BASH_PATTERNS]),
})
export type SchedulePermissionConfig = z.infer<typeof SchedulePermissionConfigSchema>

export type SchedulePermissionAction = 'allow' | 'deny' | 'ask'

export interface SchedulePermissionRuleset {
  '*': SchedulePermissionAction
  external_directory?: SchedulePermissionAction
  bash?: Record<string, SchedulePermissionAction>
}

/**
 * Builds an OpenCode permission config object for an unattended scheduled run.
 *
 * OpenCode's config/API permission format is keyed by tool, where each value is
 * either a shorthand action or a glob-pattern -> action map (see
 * https://opencode.ai/docs/permissions). A top-level `*` sets the baseline; the
 * server merges tool entries after it and the last matching rule wins, so the
 * `bash` deny patterns override the allow-all baseline for matching commands.
 */
export function buildSchedulePermissionRuleset(
  config: SchedulePermissionConfig | null | undefined,
): SchedulePermissionRuleset {
  const cfg = SchedulePermissionConfigSchema.parse(config ?? {})
  const ruleset: SchedulePermissionRuleset = { '*': 'allow' }
  if (!cfg.allowExternalDirectory) {
    ruleset.external_directory = 'deny'
  }
  if (cfg.bashDenyPatterns.length > 0) {
    const bash: Record<string, SchedulePermissionAction> = {}
    for (const pattern of cfg.bashDenyPatterns) {
      bash[pattern] = 'deny'
    }
    ruleset.bash = bash
  }
  return ruleset
}

export const ScheduleJobSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  scheduleMode: ScheduleModeSchema,
  intervalMinutes: z.number().int().min(5).max(10080).nullable(),
  cronExpression: z.string().nullable(),
  timezone: z.string().nullable(),
  agentSlug: z.string().nullable(),
  prompt: z.string(),
  model: z.string().nullable(),
  skillMetadata: ScheduleSkillMetadataSchema.nullable(),
  permissionConfig: SchedulePermissionConfigSchema.nullable(),
  branch: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
})
export type ScheduleJob = z.infer<typeof ScheduleJobSchema>

export const ScheduleRunSchema = z.object({
  id: z.number(),
  jobId: z.number(),
  repoId: z.number(),
  triggerSource: ScheduleRunTriggerSourceSchema,
  status: ScheduleRunStatusSchema,
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  createdAt: z.number(),
  sessionId: z.string().nullable(),
  sessionTitle: z.string().nullable(),
  logText: z.string().nullable(),
  responseText: z.string().nullable(),
  errorText: z.string().nullable(),
  runBranch: z.string().nullable(),
  commitHash: z.string().nullable(),
  worktreePath: z.string().nullable(),
  workspaceId: z.string().nullable(),
})
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>

const ScheduleJobBaseRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  agentSlug: z.string().min(1).max(100).optional(),
  prompt: z.string().min(1).max(20000),
  model: z.string().min(1).max(200).optional(),
  skillMetadata: ScheduleSkillMetadataSchema.nullable().optional(),
  permissionConfig: SchedulePermissionConfigSchema.nullable().optional(),
  branch: z.string().min(1).max(200).nullable().optional(),
})

export const CreateScheduleJobRequestSchema = z.discriminatedUnion('scheduleMode', [
  ScheduleJobBaseRequestSchema.extend({
    scheduleMode: z.literal('interval'),
    intervalMinutes: z.number().int().min(5).max(10080),
  }),
  ScheduleJobBaseRequestSchema.extend({
    scheduleMode: z.literal('cron'),
    cronExpression: z.string().min(1).max(200),
    timezone: z.string().min(1).max(120),
  }),
])
export type CreateScheduleJobRequest = z.infer<typeof CreateScheduleJobRequestSchema>

export const UpdateScheduleJobRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  scheduleMode: ScheduleModeSchema.optional(),
  intervalMinutes: z.number().int().min(5).max(10080).nullable().optional(),
  cronExpression: z.string().min(1).max(200).nullable().optional(),
  timezone: z.string().min(1).max(120).nullable().optional(),
  agentSlug: z.string().min(1).max(100).nullable().optional(),
  prompt: z.string().min(1).max(20000).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  skillMetadata: ScheduleSkillMetadataSchema.nullable().optional(),
  permissionConfig: SchedulePermissionConfigSchema.nullable().optional(),
  branch: z.string().min(1).max(200).nullable().optional(),
})
export type UpdateScheduleJobRequest = z.infer<typeof UpdateScheduleJobRequestSchema>

export const PromptTemplateSchema = z.object({
  id: z.number(),
  title: z.string(),
  category: z.string(),
  cadenceHint: z.string(),
  suggestedName: z.string(),
  suggestedDescription: z.string(),
  description: z.string(),
  prompt: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>

export const CreatePromptTemplateRequestSchema = z.object({
  title: z.string().min(1).max(120).transform((s) => s.trim()),
  category: z.string().min(1).max(60).transform((s) => s.trim()),
  cadenceHint: z.string().min(1).max(60).transform((s) => s.trim()),
  suggestedName: z.string().min(1).max(120).transform((s) => s.trim()),
  suggestedDescription: z.string().max(500).default('').transform((s) => s.trim()),
  description: z.string().max(500).default('').transform((s) => s.trim()),
  prompt: z.string().min(1).max(20000).transform((s) => s.trim()),
})
export type CreatePromptTemplateRequest = z.infer<typeof CreatePromptTemplateRequestSchema>

export const UpdatePromptTemplateRequestSchema = CreatePromptTemplateRequestSchema.partial()
export type UpdatePromptTemplateRequest = z.infer<typeof UpdatePromptTemplateRequestSchema>
