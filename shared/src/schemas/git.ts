import { z } from 'zod'
import { getBranchNameError } from '../utils/repo'

const branchNameSchema = z.string().trim().superRefine((value, ctx) => {
  const error = getBranchNameError(value)
  if (error) {
    ctx.addIssue({ code: 'custom', message: error })
  }
})

export const RenameBranchRequestSchema = z.object({
  from: branchNameSchema,
  to: branchNameSchema,
})

export const DeleteBranchRequestSchema = z.object({
  name: branchNameSchema,
  force: z.boolean().default(false),
  deleteRemote: z.boolean().default(false),
})

export const DeleteBranchResultSchema = z.object({
  remoteDeleted: z.boolean(),
})

export const GitStashEntrySchema = z.object({
  index: z.number().int().nonnegative(),
  ref: z.string(),
  hash: z.string(),
  message: z.string(),
  branch: z.string().nullable(),
  date: z.string(),
})

export const StashPushRequestSchema = z.object({
  message: z.string().trim().max(500).optional(),
  includeUntracked: z.boolean().default(true),
})

export const StashApplyRequestSchema = z.object({
  hash: z.string().trim().min(1),
  pop: z.boolean().default(false),
})

export const StashDropRequestSchema = z.object({
  hash: z.string().trim().min(1),
})

export const GitOperationKindSchema = z.enum(['merge', 'rebase', 'cherry-pick', 'revert'])

export const GitOperationStateSchema = z.object({
  kind: GitOperationKindSchema,
  conflictedFiles: z.array(z.string()),
})

export const IntegrateBranchRequestSchema = z.object({
  targetBranch: branchNameSchema,
  strategy: z.enum(['merge', 'cherry-pick']).default('merge'),
})

export const IntegrateBranchResultSchema = z.object({
  targetRepoId: z.number().int(),
  integratedCommits: z.number().int(),
})

export const GitIdentityScopeSchema = z.enum(['repository', 'default', 'global', 'none'])

export const RepoGitIdentitySchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  scope: GitIdentityScopeSchema,
  presetId: z.string().nullable(),
})
