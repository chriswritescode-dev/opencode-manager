import { z } from 'zod'

export const RepoStatusSchema = z.enum(['cloning', 'ready', 'error'])

export const RepoSchema = z.object({
  id: z.number(),
  repoUrl: z.string().url().optional(),
  localPath: z.string(),
  fullPath: z.string(),
  sourcePath: z.string().optional(),
  branch: z.string().optional(),
  defaultBranch: z.string(),
  cloneStatus: RepoStatusSchema,
  clonedAt: z.number(),
  lastPulled: z.number().optional(),
  openCodeConfigName: z.string().optional(),
  isWorktree: z.boolean().optional(),
  isLocal: z.boolean().optional(),
})

export const CreateRepoRequestSchema = z.object({
  repoUrl: z.string().url().optional(),
  localPath: z.string().optional(),
  branch: z.string().optional(),
  openCodeConfigName: z.string().optional(),
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
