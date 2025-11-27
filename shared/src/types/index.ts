import { z } from 'zod'
import {
  UserPreferencesSchema,
  SettingsResponseSchema,
  UpdateSettingsRequestSchema,
  CustomCommandSchema,
  CustomAgentSchema,
  OpenCodeConfigSchema,
  OpenCodeConfigMetadataSchema,
  CreateOpenCodeConfigRequestSchema,
  UpdateOpenCodeConfigRequestSchema,
  OpenCodeConfigResponseSchema,
} from '../schemas/settings'
import {
  RepoSchema,
  CreateRepoRequestSchema,
  RepoStatusSchema,
} from '../schemas/repo'
import {
  FileInfoSchema,
  CreateFileRequestSchema,
  RenameFileRequestSchema,
  FileUploadResponseSchema,
  ChunkedFileInfoSchema,
  FileRangeRequestSchema,
  PatchOperationSchema,
  FilePatchRequestSchema,
} from '../schemas/files'
import {
  SessionSchema,
  MessageSchema,
} from '../schemas/opencode'

export type UserPreferences = z.infer<typeof UserPreferencesSchema>
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>
export type CustomCommand = z.infer<typeof CustomCommandSchema>
export type CustomAgent = z.infer<typeof CustomAgentSchema>
export type OpenCodeConfig = z.infer<typeof OpenCodeConfigMetadataSchema>
export type OpenCodeConfigInput = z.infer<typeof OpenCodeConfigSchema>
export type CreateOpenCodeConfigRequest = z.infer<typeof CreateOpenCodeConfigRequestSchema>
export type UpdateOpenCodeConfigRequest = z.infer<typeof UpdateOpenCodeConfigRequestSchema>
export type OpenCodeConfigResponse = z.infer<typeof OpenCodeConfigResponseSchema>

export type Repo = z.infer<typeof RepoSchema>
export type CreateRepoRequest = z.infer<typeof CreateRepoRequestSchema>
export type RepoStatus = z.infer<typeof RepoStatusSchema>

export type FileInfo = z.infer<typeof FileInfoSchema>
export type CreateFileRequest = z.infer<typeof CreateFileRequestSchema>
export type RenameFileRequest = z.infer<typeof RenameFileRequestSchema>
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>
export type ChunkedFileInfo = z.infer<typeof ChunkedFileInfoSchema>
export type FileRangeRequest = z.infer<typeof FileRangeRequestSchema>
export type PatchOperation = z.infer<typeof PatchOperationSchema>
export type FilePatchRequest = z.infer<typeof FilePatchRequestSchema>

export type Session = z.infer<typeof SessionSchema>
export type Message = z.infer<typeof MessageSchema>

export interface ErrorResponse {
  error: string
  details?: unknown
}

export interface SuccessResponse {
  success: boolean
}
