import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_STT_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_LEADER_KEY,
  type TTSConfig,
  type STTConfig,
  type OpenCodeConfigContent,
} from '@opencode-manager/shared'
import type { NotificationPreferences } from '@opencode-manager/shared/types'

export type { TTSConfig, STTConfig, OpenCodeConfigContent, NotificationPreferences }
export { DEFAULT_TTS_CONFIG, DEFAULT_STT_CONFIG, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_USER_PREFERENCES, DEFAULT_LEADER_KEY }

export interface CustomCommand {
  name: string
  description: string
  promptTemplate: string
}

export interface CustomAgent {
  name: string
  description: string
  config: Record<string, unknown>
}

export interface GitCredential {
  name: string
  host: string
  token: string
  username?: string
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
  showReasoning: boolean
  expandToolCalls: boolean
  expandDiffs: boolean
  leaderKey?: string
  directShortcuts?: string[]
  keyboardShortcuts: Record<string, string>
  customCommands: CustomCommand[]
  customAgents: CustomAgent[]
  gitCredentials?: GitCredential[]
  gitIdentity?: GitIdentity
  tts?: TTSConfig
  stt?: STTConfig
  notifications?: NotificationPreferences
  repoOrder?: number[]
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
  content: OpenCodeConfigContent
  rawContent?: string
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
