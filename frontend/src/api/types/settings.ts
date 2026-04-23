import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_STT_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_LEADER_KEY,
  type TTSConfig,
  type STTConfig,
  type OpenCodeConfigContent,
  type ModelConfig,
  type ProviderConfig,
  type SkillFileInfo,
  type CreateSkillRequest,
  type UpdateSkillRequest,
  type SkillScope,
} from '@opencode-manager/shared'
import type { NotificationPreferences } from '@opencode-manager/shared/types'

export type { TTSConfig, STTConfig, OpenCodeConfigContent, ModelConfig, ProviderConfig, NotificationPreferences, SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope }
export { DEFAULT_TTS_CONFIG, DEFAULT_STT_CONFIG, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_USER_PREFERENCES, DEFAULT_LEADER_KEY }

export interface CustomCommand {
  name: string
  description: string
  promptTemplate: string
}

export interface GitCredential {
  name: string
  host: string
  type: 'pat' | 'ssh'
  token?: string
  sshPrivateKey?: string
  sshPrivateKeyEncrypted?: string
  hasPassphrase?: boolean
  username?: string
  passphrase?: string
}

export interface GitIdentity {
  name: string
  email: string
}

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system'
  mode: 'plan' | 'build'
  defaultModel?: string
  defaultAgent?: string
  autoScroll: boolean
  expandDiffs: boolean
  expandToolCalls: boolean
  showReasoning: boolean
  simpleChatMode: boolean
  leaderKey?: string
  directShortcuts?: string[]
  keyboardShortcuts: Record<string, string>
  customCommands: CustomCommand[]
  gitCredentials?: GitCredential[]
  gitIdentity?: GitIdentity
  tts?: TTSConfig
  stt?: STTConfig
  notifications?: NotificationPreferences
  repoOrder?: number[]
  repoSortMode?: 'recent' | 'manual' | 'name'
  memoryDedupThreshold?: number
}

export interface SettingsResponse {
  preferences: UserPreferences
  updatedAt: number
  serverRestarted?: boolean
  reloadError?: string
}

export interface UpdateSettingsRequest {
  preferences: Partial<UserPreferences>
}

export interface OpenCodeConfig {
  id: number
  name: string
  content: Record<string, unknown>
  rawContent?: string
  validationIssues?: Array<{
    path: string
    message: string
  }>
  removedFields?: string[]
  isValid: boolean
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface CreateOpenCodeConfigRequest {
  name: string
  content: OpenCodeConfigContent | string
  isDefault?: boolean
}

export interface UpdateOpenCodeConfigRequest {
  content: OpenCodeConfigContent | string
  isDefault?: boolean
}

export interface OpenCodeConfigResponse {
  configs: OpenCodeConfig[]
  defaultConfig: OpenCodeConfig | null
}

export interface OpenCodeImportStatus {
  configSourcePath: string | null
  stateSourcePath: string | null
  workspaceConfigPath: string
  workspaceStatePath: string
  workspaceStateExists: boolean
}

export interface SyncOpenCodeImportResponse extends OpenCodeImportStatus {
  success: boolean
  message: string
  serverRestarted: boolean
  configImported: boolean
  stateImported: boolean
  relinkedRepos?: {
    repos: Array<Record<string, unknown>>
    relinkedCount: number
    existingCount: number
    nonRepoPathCount: number
    duplicatePathCount: number
    errors: Array<{ path: string; error: string }>
  }
}
