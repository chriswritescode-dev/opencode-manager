import { z } from 'zod'

export const FileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  size: z.number(),
  mimeType: z.string().optional(),
  content: z.string().optional(),
  get children() {
    return z.array(FileInfoSchema).optional()
  },
  lastModified: z.coerce.date(),
  workspaceRoot: z.string().optional(),
  totalLines: z.number().optional(),
})

export const CreateFileRequestSchema = z.object({
  type: z.enum(['file', 'folder']),
  content: z.string().optional(),
})

export const RenameFileRequestSchema = z.object({
  newPath: z.string(),
})

export const FileUploadResponseSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number(),
  mimeType: z.string(),
})

export const ChunkedFileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.literal(false),
  size: z.number(),
  mimeType: z.string().optional(),
  lines: z.array(z.string()),
  totalLines: z.number(),
  startLine: z.number(),
  endLine: z.number(),
  hasMore: z.boolean(),
  lastModified: z.coerce.date(),
})

export const FileRangeRequestSchema = z.object({
  startLine: z.number().int().min(0),
  endLine: z.number().int().min(0),
})

export const PatchOperationSchema = z.object({
  type: z.enum(['replace', 'insert', 'delete']),
  startLine: z.number().int().min(0),
  endLine: z.number().int().min(0).optional(),
  content: z.string().optional(),
})

export const FilePatchRequestSchema = z.object({
  patches: z.array(PatchOperationSchema),
})

