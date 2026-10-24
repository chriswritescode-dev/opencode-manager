import { z } from 'zod'
import { TerminalInfoSchema } from './terminal'
import { ENV_NAME_PATTERN, EnvironmentNameSchema, isReservedEnvName } from './secrets'
import { parseEnvExpressionReferences } from '../utils/env-expressions'

export const ProjectActionIconSchema = z.enum([
  'play',
  'build',
  'test',
  'lint',
  'terminal',
  'server',
  'bug',
  'rocket',
])

export const ProjectActionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1).max(4000),
  icon: ProjectActionIconSchema.optional(),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://')
    .optional(),
  autoOpenUrl: z.boolean().default(false),
})

export const WorktreeSetupCommandsSchema = z.array(z.string().trim().min(1).max(4000)).max(20)

export const ProjectItemSourceSchema = z.enum(['personal', 'repo'])

export const REPO_PROJECT_ENV_MAX_ENTRIES = 100

const REPO_PROJECT_ENV_RESERVED_NAMES = ['GH_TOKEN'] as const

const REPO_PROJECT_ENV_RESERVED_PREFIXES = ['GITHUB_', 'GIT_'] as const

function isRepoProjectEnvGitReserved(name: string): boolean {
  const normalized = name.toUpperCase()
  if ((REPO_PROJECT_ENV_RESERVED_NAMES as readonly string[]).includes(normalized)) return true
  return REPO_PROJECT_ENV_RESERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export const RepoProjectEnvValueSchema = z
  .string()
  .max(4000, 'Environment value must be at most 4000 characters')
  .superRefine((value, ctx) => {
    const parsed = parseEnvExpressionReferences(value)
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error })
    }
  })

export const RepoProjectEnvSchema = z
  .record(z.string(), RepoProjectEnvValueSchema)
  .superRefine((env, ctx) => {
    for (const key of Object.keys(env)) {
      if (!ENV_NAME_PATTERN.test(key)) {
        ctx.addIssue({ code: 'custom', message: `${key} is not a valid environment variable name`, path: [key] })
      } else if (isReservedEnvName(key)) {
        ctx.addIssue({ code: 'custom', message: `${key} is reserved for Manager or the runtime`, path: [key] })
      } else if (isRepoProjectEnvGitReserved(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `${key} is reserved for git authentication; map the value in a local env file or use a secret instead`,
          path: [key],
        })
      }
    }
  })
  .refine(
    (env) => Object.keys(env).length <= REPO_PROJECT_ENV_MAX_ENTRIES,
    `At most ${REPO_PROJECT_ENV_MAX_ENTRIES} environment entries are allowed`,
  )

export const RepoProjectFileSchema = z.looseObject({
  version: z.literal(1),
  projectActions: z.array(ProjectActionSchema).optional(),
  setupWorktree: WorktreeSetupCommandsSchema.optional(),
  environment: EnvironmentNameSchema.optional(),
  env: RepoProjectEnvSchema.optional(),
})

export const ProjectConfigResponseSchema = z.object({
  actions: z.array(
    ProjectActionSchema.extend({
      source: ProjectItemSourceSchema,
      resolvedUrl: z.string().optional(),
    }),
  ),
  worktreeSetup: z.array(
    z.object({
      command: z.string(),
      source: ProjectItemSourceSchema,
    }),
  ),
  repoFile: z.object({
    path: z.literal('.ocm/project.json'),
    exists: z.boolean(),
    trusted: z.boolean(),
    hash: z.string().nullable(),
    executable: z
      .object({
        actions: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            command: z.string(),
            url: z.string().nullable(),
            autoOpenUrl: z.boolean(),
          }),
        ),
        setup: z.array(z.string()),
        environment: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
      .nullable(),
    error: z.string().optional(),
    warnings: z.array(z.string()),
  }),
})

export const UpdateProjectActionsRequestSchema = z.object({
  actions: z.array(ProjectActionSchema).max(50),
})

export const UpdateWorktreeSetupRequestSchema = z.object({
  commands: WorktreeSetupCommandsSchema,
})

export const TrustRepoConfigRequestSchema = z.object({
  directory: z.string().optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
})

export const MoveProjectItemRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    id: z.string(),
    to: ProjectItemSourceSchema,
    directory: z.string().optional(),
  }),
  z.object({
    kind: z.literal('setup'),
    command: z.string(),
    to: ProjectItemSourceSchema,
    directory: z.string().optional(),
  }),
])

export const RunProjectActionRequestSchema = z.object({
  directory: z.string().optional(),
})

export const RunProjectActionResponseSchema = z.object({
  terminal: TerminalInfoSchema,
  alreadyRunning: z.boolean(),
  resolvedUrl: z.string().optional(),
  autoOpenUrl: z.boolean(),
})

export const WorktreeSetupResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({
    status: z.literal('started'),
    terminal: TerminalInfoSchema,
    repoCommandsSkipped: z.boolean(),
  }),
  z.object({ status: z.literal('skipped'), reason: z.literal('untrusted') }),
  z.object({ status: z.literal('failed'), error: z.string() }),
])

export type ProjectActionIcon = z.infer<typeof ProjectActionIconSchema>
export type ProjectAction = z.infer<typeof ProjectActionSchema>
export type WorktreeSetupCommands = z.infer<typeof WorktreeSetupCommandsSchema>
export type ProjectItemSource = z.infer<typeof ProjectItemSourceSchema>
export type RepoProjectFile = z.infer<typeof RepoProjectFileSchema>
export type ProjectConfigResponse = z.infer<typeof ProjectConfigResponseSchema>
export type UpdateProjectActionsRequest = z.infer<typeof UpdateProjectActionsRequestSchema>
export type UpdateWorktreeSetupRequest = z.infer<typeof UpdateWorktreeSetupRequestSchema>
export type TrustRepoConfigRequest = z.infer<typeof TrustRepoConfigRequestSchema>
export type MoveProjectItemRequest = z.infer<typeof MoveProjectItemRequestSchema>
export type RunProjectActionRequest = z.infer<typeof RunProjectActionRequestSchema>
export type RunProjectActionResponse = z.infer<typeof RunProjectActionResponseSchema>
export type WorktreeSetupResult = z.infer<typeof WorktreeSetupResultSchema>
