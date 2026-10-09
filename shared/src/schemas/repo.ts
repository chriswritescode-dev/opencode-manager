import { z } from 'zod'
import { getRepoDirectoryNameError } from '../utils/repo'
import { WorktreeSetupResultSchema } from './project-config'

export const RepoStatusSchema = z.enum(['cloning', 'ready', 'error'])

export const RepoSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  repoUrl: z.string().url().optional(),
  localPath: z.string(),
  fullPath: z.string(),
  sourcePath: z.string().optional(),
  branch: z.string().optional(),
  defaultBranch: z.string(),
  cloneStatus: RepoStatusSchema,
  clonedAt: z.number(),
  lastPulled: z.number().optional(),
  lastAccessedAt: z.number().optional(),
  gitCredentialId: z.string().optional(),
  isWorktree: z.boolean().optional(),
  isLocal: z.boolean().optional(),
})

export const InternalRepoListResponseSchema = z.object({
  repos: z.array(RepoSchema),
})

export const InternalCloneRepoRequestSchema = z.object({
  repoUrl: z.string().trim().min(1),
  branch: z.string().trim().min(1).optional(),
  directoryName: z.string().trim().min(1).optional(),
}).strict()

export const CreateRepoRequestSchema = z.object({
  repoUrl: z.string().url().optional(),
  localPath: z.string().optional(),
  branch: z.string().optional(),
  directoryName: z.string().optional(),
  useWorktree: z.boolean().optional(),
  skipSSHVerification: z.boolean().optional(),
}).refine(
  (data) => data.repoUrl || data.localPath,
  {
    message: "Either repoUrl or localPath must be provided",
    path: ["repoUrl"],
  }
)

export const DiscoverReposRequestSchema = z.object({
  rootPath: z.string().trim().min(1),
  maxDepth: z.number().int().min(0).max(8).optional(),
})

export const UpdateRepoRequestSchema = z.object({
  name: z.string().trim().max(100).nullable(),
})

export const CreateRepoWorkspaceRequestSchema = z.object({
  name: z.string().trim().optional().superRefine((name, ctx) => {
    const error = name ? getRepoDirectoryNameError(name) : null
    if (error) ctx.addIssue({ code: 'custom', message: error })
  }),
})

export const DeleteRepoRequestSchema = z.object({
  deleteBranch: z.enum(['none', 'local', 'local-and-remote']).default('none'),
})

export const DeleteRepoResultSchema = z.object({
  success: z.literal(true),
  branch: z.object({
    name: z.string(),
    deleted: z.boolean(),
    remoteDeleted: z.boolean(),
    error: z.string().optional(),
  }).optional(),
})

export const DiscoverReposResponseSchema = z.object({
  repos: z.array(RepoSchema),
  discoveredCount: z.number().int().nonnegative(),
  existingCount: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      path: z.string(),
      error: z.string(),
    })
  ),
})

export const AssistantModeFileSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  created: z.boolean(),
})

export const AssistantModeStatusSchema = z.object({
  repoId: z.number(),
  directory: z.string(),
  relativePath: z.literal('repos/assistant'),
  warnings: z.array(z.object({
    code: z.string(),
    path: z.string(),
    message: z.string(),
  })).optional(),
  files: z.object({
    agentsMd: AssistantModeFileSchema,
    opencodeJson: AssistantModeFileSchema,
  }),

  schedulesSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  notificationsSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  settingsSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  repoManagementSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  sessionManagementSkill: z.object({
    path: z.string(),
    created: z.boolean(),
  }).optional(),
  defaultAgent: z.object({
    name: z.literal('assistant'),
    path: z.string(),
    exists: z.boolean(),
    created: z.boolean(),
  }).optional(),
})

export const AssistantModeInitRequestSchema = z.object({
  overwriteAgentsMd: z.boolean().optional(),
  overwriteOpenCodeConfig: z.boolean().optional(),
})

export const MirrorTargetBranchRequestSchema = z.object({
  branch: z.string().trim().min(1),
})

export type MirrorTargetBranchRequest = z.infer<typeof MirrorTargetBranchRequestSchema>

export const MirrorCheckoutStateSchema = z.object({
  directory: z.string().min(1),
  branch: z.string().min(1).nullable(),
  head: z.string().min(1).nullable(),
  dirty: z.boolean(),
})

export type MirrorCheckoutState = z.infer<typeof MirrorCheckoutStateSchema>

export const MirrorCheckoutsResponseSchema = z.object({
  main: MirrorCheckoutStateSchema,
  worktrees: z.array(MirrorCheckoutStateSchema),
  branchHead: z.string().min(1).nullable(),
  branchCheckedOut: z.boolean(),
  suffixedWorktreeBranch: z.string().min(1),
})

export type MirrorCheckoutsResponse = z.infer<typeof MirrorCheckoutsResponseSchema>

export const MirrorWorktreeCreateResponseSchema = z.object({
  repoId: z.number(),
  fullPath: z.string().min(1),
  branch: z.string().min(1).nullable(),
  head: z.string().min(1).nullable(),
  created: z.literal(true),
  worktreeSetup: WorktreeSetupResultSchema,
})

export type MirrorWorktreeCreateResponse = z.infer<typeof MirrorWorktreeCreateResponseSchema>
