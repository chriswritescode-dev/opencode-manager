import { z } from 'zod'

export const SkillSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  content: z.string(),
  location: z.string(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const CreateSkillRequestSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  content: z.string().min(1),
})

export const UpdateSkillRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(1024).optional(),
  content: z.string().min(1).optional(),
})

export const SkillsListResponseSchema = z.object({
  skills: z.array(SkillSchema),
})

export type Skill = z.infer<typeof SkillSchema>
export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>
export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>
export type SkillsListResponse = z.infer<typeof SkillsListResponseSchema>
