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
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export const CreateSkillRequestSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(1024),
  body: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  scope: SkillScopeSchema,
  repoId: z.number().optional(),
})

export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>

export const UpdateSkillRequestSchema = z.object({
  description: z.string().min(1).max(1024).optional(),
  body: z.string().optional(),
  license: z.string().nullable().optional(),
  compatibility: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
})

export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>

export interface SkillFileInfo {
  name: string
  description: string
  body: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  scope: SkillScope
  location: string
  repoId?: number
  repoName?: string
}
