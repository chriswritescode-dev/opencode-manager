import { z } from 'zod'
import {
  UserPreferencesSchema,
  SettingsResponseSchema,
  UpdateSettingsRequestSchema,
  CustomCommandSchema,
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
import {
  NotificationPreferencesSchema,
  PushSubscriptionRequestSchema,
  PushSubscriptionRecordSchema,
  PushNotificationPayloadSchema,
} from '../schemas/notifications'

export type UserPreferences = z.infer<typeof UserPreferencesSchema>
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>
export type CustomCommand = z.infer<typeof CustomCommandSchema>
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

export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequestSchema>
export type PushSubscriptionRecord = z.infer<typeof PushSubscriptionRecordSchema>
export type PushNotificationPayload = z.infer<typeof PushNotificationPayloadSchema>

export { FetchError } from './errors'
export type { ApiErrorResponse, ApiErrorCode, GitErrorCode } from './errors'

export interface SuccessResponse {
  success: boolean
}

export type { SSHHostKeyRequest, SSHHostKeyResponse, TrustedSSHHost } from '../schemas/ssh'
export type { GitCredential } from '../schemas/settings'

export type {
  Memory,
  MemoryScope,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  MemoryStats,
  EmbeddingProviderType,
  EmbeddingConfig,
  LoggingConfig,
  PluginConfig,
} from '../schemas/memory'
