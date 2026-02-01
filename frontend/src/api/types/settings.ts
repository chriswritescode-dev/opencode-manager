import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_STT_CONFIG,
  DEFAULT_TALK_MODE_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_SESSION_PRUNE_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_USER_PREFERENCES,
  type TTSConfig,
  type STTConfig,
  type TalkModeConfig,
  type NotificationConfig,
  type SessionPruneConfig,
  type OpenCodeConfigContent,
} from '@opencode-manager/shared'

export type { TTSConfig, STTConfig, TalkModeConfig, NotificationConfig, SessionPruneConfig, OpenCodeConfigContent }
export { DEFAULT_TTS_CONFIG, DEFAULT_STT_CONFIG, DEFAULT_TALK_MODE_CONFIG, DEFAULT_NOTIFICATION_CONFIG, DEFAULT_SESSION_PRUNE_CONFIG, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_USER_PREFERENCES }

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

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system'
  mode: 'plan' | 'build'
  defaultModel?: string
  defaultAgent?: string
  autoScroll: boolean
  showReasoning: boolean
  expandToolCalls: boolean
  expandDiffs: boolean
  keyboardShortcuts: Record<string, string>
  customCommands: CustomCommand[]
  customAgents: CustomAgent[]
  gitToken?: string
  tts?: TTSConfig
  stt?: STTConfig
  talkMode?: TalkModeConfig
  notifications?: NotificationConfig
  sessionPrune?: SessionPruneConfig
}

export interface SettingsResponse {
  preferences: UserPreferences
  updatedAt: number
  serverRestarted?: boolean
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
