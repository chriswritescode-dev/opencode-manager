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
  ServerEnvVarSchema,
} from '../schemas/settings'
import {
  RepoSchema,
  InternalRepoListResponseSchema,
  CreateRepoRequestSchema,
  DiscoverReposRequestSchema,
  DiscoverReposResponseSchema,
  RepoStatusSchema,
  AssistantModeStatusSchema,
  AssistantModeInitRequestSchema,
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
import {
  AssistantNotificationPrioritySchema,
  AssistantNotificationRequestSchema,
  AssistantNotificationResponseSchema,
  AssistantSettingsPatchSchema,
} from '../schemas/internal-assistant'

export type UserPreferences = z.infer<typeof UserPreferencesSchema>
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>
export type CustomCommand = z.infer<typeof CustomCommandSchema>
export type ServerEnvVar = z.infer<typeof ServerEnvVarSchema>
export type OpenCodeConfig = z.infer<typeof OpenCodeConfigMetadataSchema>
export type OpenCodeConfigInput = z.infer<typeof OpenCodeConfigSchema>
export type CreateOpenCodeConfigRequest = z.infer<typeof CreateOpenCodeConfigRequestSchema>
export type UpdateOpenCodeConfigRequest = z.infer<typeof UpdateOpenCodeConfigRequestSchema>
export type OpenCodeConfigResponse = z.infer<typeof OpenCodeConfigResponseSchema>

export type Repo = z.infer<typeof RepoSchema>
export type InternalRepoListResponse = z.infer<typeof InternalRepoListResponseSchema>
export type CreateRepoRequest = z.infer<typeof CreateRepoRequestSchema>
export type DiscoverReposRequest = z.infer<typeof DiscoverReposRequestSchema>
export type DiscoverReposResponse = z.infer<typeof DiscoverReposResponseSchema>
export type RepoStatus = z.infer<typeof RepoStatusSchema>
export type AssistantModeStatus = z.infer<typeof AssistantModeStatusSchema>
export type AssistantModeInitRequest = z.infer<typeof AssistantModeInitRequestSchema>

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

export type AssistantNotificationPriority = z.infer<typeof AssistantNotificationPrioritySchema>
export type AssistantNotificationRequest = z.infer<typeof AssistantNotificationRequestSchema>
export type AssistantNotificationResponse = z.infer<typeof AssistantNotificationResponseSchema>
export type AssistantSettingsPatch = z.infer<typeof AssistantSettingsPatchSchema>

export { FetchError } from './errors'
export type { ApiErrorResponse, ApiErrorCode, GitErrorCode } from './errors'
export { BLOCKED_SERVER_ENV_KEYS, DEFAULT_SERVER_ENV_VARS } from '../schemas/settings'

export interface SuccessResponse {
  success: boolean
}

export type { SSHHostKeyRequest, SSHHostKeyResponse, TrustedSSHHost } from '../schemas/ssh'
export type { GitCredential } from '../schemas/settings'
export type {
  ProviderApiConfig,
  ModelConfig,
  ProviderConfig,
  ProviderSource,
} from '../schemas/settings'

export type {
  ScheduleMode,
  ScheduleRunTriggerSource,
  ScheduleRunStatus,
  ScheduleSkillMetadata,
  ScheduleJob,
  ScheduleRun,
  CreateScheduleJobRequest,
  UpdateScheduleJobRequest,
  PromptTemplate,
  CreatePromptTemplateRequest,
  UpdatePromptTemplateRequest,
} from '../schemas/schedule'

export type {
  SkillScope,
  SkillFrontmatter,
  CreateSkillRequest,
  UpdateSkillRequest,
  SkillFileInfo,
  InstallSkillFromGithubRequest,
  InstallSkillUploadRequest,
  InstallSkillUploadManifestEntry,
  InstallSkillResponse,
} from '../schemas/skills'
export {
  SKILL_NAME_REGEX,
  SkillNameSchema,
  SkillScopeSchema,
  SkillFrontmatterSchema,
  CreateSkillRequestSchema,
  UpdateSkillRequestSchema,
  InstallSkillFromGithubRequestSchema,
  InstallSkillUploadRequestSchema,
  InstallSkillUploadManifestEntrySchema,
} from '../schemas/skills'
