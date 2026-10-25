import { z } from 'zod'
import { SessionSandboxResourcesSchema } from './session-sandbox'

export const ScheduleRunTriggerSourceSchema = z.enum(['manual', 'schedule'])
export type ScheduleRunTriggerSource = z.infer<typeof ScheduleRunTriggerSourceSchema>

export const ScheduleRunStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled'])
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>

export const ScheduleModeSchema = z.enum(['interval', 'cron'])
export type ScheduleMode = z.infer<typeof ScheduleModeSchema>

/**
 * Where a scheduled run executes. `worktree` gives every run a fresh worktree that is
 * removed when the run ends, `kept-worktree` keeps each run's worktree afterwards, and
 * `shared-worktree` reuses one worktree and branch for every run of the schedule.
 * `in-place` runs directly in the target directory and is the only mode available for a
 * project on a linked remote OpenCode server, which has no local checkout to branch from.
 */
export const ScheduleWorkspaceModeSchema = z.enum(['worktree', 'kept-worktree', 'shared-worktree', 'in-place'])
export type ScheduleWorkspaceMode = z.infer<typeof ScheduleWorkspaceModeSchema>

/**
 * What clearing run history does with the run worktrees that still exist on disk.
 * `commit` commits their pending changes to their branches and keeps those branches;
 * `discard` force-removes the worktrees and deletes their branches.
 */
export const ScheduleRunWorktreesModeSchema = z.enum(['commit', 'discard']).default('commit')
export type ScheduleRunWorktreesMode = z.infer<typeof ScheduleRunWorktreesModeSchema>

/**
 * A schedule worktree that still exists on disk. `runId` is null for the schedule's
 * shared worktree, and `inUse` is true while a running run is working in it.
 */
export const ScheduleWorktreeSchema = z.object({
  worktreePath: z.string(),
  branch: z.string(),
  runId: z.number().nullable(),
  inUse: z.boolean(),
})
export type ScheduleWorktree = z.infer<typeof ScheduleWorktreeSchema>

export const RemoveScheduleWorktreesRequestSchema = z.object({
  worktreePath: z.string().min(1).optional(),
})
export type RemoveScheduleWorktreesRequest = z.infer<typeof RemoveScheduleWorktreesRequestSchema>

export const ScheduleSkillMetadataSchema = z.object({
  skillSlugs: z.array(z.string().min(1).max(100)).default([]),
  notes: z.string().max(2000).optional(),
})
export type ScheduleSkillMetadata = z.infer<typeof ScheduleSkillMetadataSchema>

const ScheduleMcpTimeoutSchema = z.object({
  startup: z.number().int().positive().optional(),
  catalog: z.number().int().positive().optional(),
  execution: z.number().int().positive().optional(),
})

const ScheduleMcpProtocolSchema = z.enum(['legacy', 'auto', '2026-07-28'])

export const ScheduleMcpServerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    command: z.array(z.string().min(1)).min(1),
    cwd: z.string().optional(),
    environment: z.record(z.string(), z.string()).optional(),
    codemode: z.boolean().optional(),
    timeout: ScheduleMcpTimeoutSchema.optional(),
    protocol: ScheduleMcpProtocolSchema.optional(),
  }),
  z.object({
    type: z.literal('remote'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    oauth: z.union([
      z.object({
        client_id: z.string().optional(),
        client_secret: z.string().optional(),
        scope: z.string().optional(),
        callback_port: z.number().int().min(1).max(65535).optional(),
        redirect_uri: z.string().optional(),
        auth_server_metadata_url: z.string().optional(),
      }),
      z.literal(false),
    ]).optional(),
    codemode: z.boolean().optional(),
    timeout: ScheduleMcpTimeoutSchema.optional(),
    protocol: ScheduleMcpProtocolSchema.optional(),
  }),
])
export type ScheduleMcpServerConfig = z.infer<typeof ScheduleMcpServerConfigSchema>

/**
 * An MCP server attached to a schedule. Without `config` it names a server from
 * the OpenCode configuration, which is connected for the run even when disabled.
 * With `config` it is a schedule-only server added to the run's location.
 */
export const ScheduleMcpServerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  config: ScheduleMcpServerConfigSchema.optional(),
})
export type ScheduleMcpServer = z.infer<typeof ScheduleMcpServerSchema>

export const ScheduleMcpServersSchema = z.array(ScheduleMcpServerSchema).max(50).refine(
  (servers) => new Set(servers.map((server) => server.name)).size === servers.length,
  { message: 'MCP server names must be unique' },
)

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
  allowQuestions: z.boolean().default(false),
  bashDenyPatterns: z.array(z.string().min(1).max(200)).max(200)
    .default([...DEFAULT_DESTRUCTIVE_BASH_PATTERNS]),
})
export type SchedulePermissionConfig = z.infer<typeof SchedulePermissionConfigSchema>

/**
 * Sandbox settings for a scheduled run's session. `resources` overrides the
 * default CPU and memory limits; null keeps the server defaults.
 */
export const ScheduleSandboxConfigSchema = z.object({
  enabled: z.boolean(),
  resources: SessionSandboxResourcesSchema.nullable(),
})
export type ScheduleSandboxConfig = z.infer<typeof ScheduleSandboxConfigSchema>

export type SchedulePermissionEffect = 'allow' | 'deny' | 'ask'

/**
 * A single OpenCode 2 session permission rule. `action` is the tool or permission
 * action (e.g. `shell`, `external_directory`, or `*` for all), `resource` is the
 * glob matched against the tool argument, and `effect` is the resulting decision.
 */
export interface SchedulePermissionRule {
  action: string
  resource: string
  effect: SchedulePermissionEffect
}

export type SchedulePermissionRuleset = SchedulePermissionRule[]

/**
 * Builds the OpenCode session permission ruleset for an unattended scheduled run.
 *
 * OpenCode's `POST /session` `permissions` field expects an ordered array of
 * `{ action, resource, effect }` rules (`Permission.Ruleset`), evaluated with
 * last-match-wins semantics (see https://opencode.ai/docs/permissions).
 * A leading `*`/`*` allow rule sets the allow-all baseline; the trailing
 * `external_directory`, `question` and `shell` deny rules then override it for
 * external directory access, agent questions that would block an unattended run
 * with nobody to answer them, and matching destructive command patterns.
 */
export function buildSchedulePermissionRuleset(
  config: SchedulePermissionConfig | null | undefined,
): SchedulePermissionRuleset {
  const cfg = SchedulePermissionConfigSchema.parse(config ?? {})
  const ruleset: SchedulePermissionRuleset = [{ action: '*', resource: '*', effect: 'allow' }]
  if (!cfg.allowExternalDirectory) {
    ruleset.push({ action: 'external_directory', resource: '*', effect: 'deny' })
  }
  if (!cfg.allowQuestions) {
    ruleset.push({ action: 'question', resource: '*', effect: 'deny' })
  }
  for (const pattern of cfg.bashDenyPatterns) {
    ruleset.push({ action: 'shell', resource: pattern, effect: 'deny' })
  }
  return ruleset
}

export const ScheduleJobSchema = z.object({
  id: z.number(),
  repoId: z.number().nullable(),
  serverId: z.string().optional(),
  directory: z.string().nullable().optional(),
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
  mcpServers: ScheduleMcpServersSchema,
  branch: z.string().nullable(),
  workspaceMode: ScheduleWorkspaceModeSchema,
  sandbox: ScheduleSandboxConfigSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
})
export type ScheduleJob = z.infer<typeof ScheduleJobSchema>

export const ScheduleRunSchema = z.object({
  id: z.number(),
  jobId: z.number(),
  repoId: z.number().nullable(),
  serverId: z.string().optional(),
  triggerSource: ScheduleRunTriggerSourceSchema,
  status: ScheduleRunStatusSchema,
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  viewedAt: z.number().nullable(),
  createdAt: z.number(),
  sessionId: z.string().nullable(),
  sessionTitle: z.string().nullable(),
  logText: z.string().nullable(),
  responseText: z.string().nullable(),
  errorText: z.string().nullable(),
  runBranch: z.string().nullable(),
  commitHash: z.string().nullable(),
  worktreePath: z.string().nullable(),
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
  mcpServers: ScheduleMcpServersSchema.optional(),
  branch: z.string().min(1).max(200).nullable().optional(),
  workspaceMode: ScheduleWorkspaceModeSchema.optional(),
  sandbox: ScheduleSandboxConfigSchema.nullable().optional(),
  directory: z.string().min(1).max(4096).optional(),
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
  mcpServers: ScheduleMcpServersSchema.optional(),
  branch: z.string().min(1).max(200).nullable().optional(),
  workspaceMode: ScheduleWorkspaceModeSchema.optional(),
  sandbox: ScheduleSandboxConfigSchema.nullable().optional(),
  directory: z.string().min(1).max(4096).nullable().optional(),
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
