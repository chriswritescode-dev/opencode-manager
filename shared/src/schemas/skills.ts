import { z } from 'zod'

export const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const SkillNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(SKILL_NAME_REGEX, 'Skill name must be lowercase alphanumeric with hyphens only (e.g., my-skill)')

export const SkillScopeSchema = z.enum(['global', 'project'])
export type SkillScope = z.infer<typeof SkillScopeSchema>

export const SkillFrontmatterSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(1024),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export const CreateSkillRequestSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(1024),
  body: z.string(),
  scope: SkillScopeSchema,
  repoId: z.number().optional(),
})

export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>

export const UpdateSkillRequestSchema = z.object({
  description: z.string().min(1).max(1024).optional(),
  body: z.string().optional(),
})

export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>

export interface SkillFileInfo {
  name: string
  description: string
  body: string
  scope: SkillScope
  location: string
  repoId?: number
  repoName?: string
}

export const InstallSkillFromGithubRequestSchema = z.object({
  sourceType: z.literal('github'),
  url: z.string().url(),
  scope: SkillScopeSchema,
  repoId: z.number().optional(),
  overwrite: z.boolean().optional(),
})
export type InstallSkillFromGithubRequest = z.infer<typeof InstallSkillFromGithubRequestSchema>

export const InstallSkillUploadManifestEntrySchema = z.object({
  fieldName: z.string().min(1),
  relativePath: z.string().min(1),
})
export type InstallSkillUploadManifestEntry = z.infer<typeof InstallSkillUploadManifestEntrySchema>

export const InstallSkillUploadRequestSchema = z.object({
  sourceType: z.literal('upload'),
  scope: SkillScopeSchema,
  repoId: z.number().optional(),
  overwrite: z.boolean().optional(),
})
export type InstallSkillUploadRequest = z.infer<typeof InstallSkillUploadRequestSchema>

export interface InstallSkillResponse {
  skill: SkillFileInfo
  overwritten: boolean
  sourceType: 'github' | 'upload'
  filesInstalled: string[]
}
