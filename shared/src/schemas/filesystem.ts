import { z } from 'zod'

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isGitRepo: z.boolean(),
})

export const BrowseDirectoryResponseSchema = z.object({
  path: z.string(),
  parentPath: z.string().nullable(),
  isRoot: z.boolean(),
  entries: z.array(DirectoryEntrySchema),
})

export const BrowseDirectoryRequestSchema = z.object({
  path: z.string().optional(),
})
