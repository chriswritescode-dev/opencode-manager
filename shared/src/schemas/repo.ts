import { z } from 'zod'

export const RepoStatusSchema = z.enum(['cloning', 'ready', 'error'])

export const RepoSchema = z.object({
  id: z.number(),
  repoUrl: z.string().url().optional(),
  localPath: z.string(),
  fullPath: z.string(),
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
