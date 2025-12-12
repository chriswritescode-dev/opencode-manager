export interface CustomCommand {
  name: string
  description: string
  promptTemplate: string
}

export interface TTSConfig {
  enabled: boolean
  endpoint: string
  apiKey: string
  voice: string
  model: string
  speed: number
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  endpoint: 'https://api.openai.com/v1/audio/speech',
  apiKey: '',
  voice: 'alloy',
  model: 'tts-1',
  speed: 1.0,
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
  keyboardShortcuts: Record<string, string>
  customCommands: CustomCommand[]
  customAgents: CustomAgent[]
  gitToken?: string
  tts?: TTSConfig
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
  content: Record<string, unknown>
  rawContent?: string
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface CreateOpenCodeConfigRequest {
  name: string
  content: Record<string, unknown> | string
  isDefault?: boolean
}

export interface UpdateOpenCodeConfigRequest {
  content: Record<string, unknown> | string
  isDefault?: boolean
}

export interface OpenCodeConfigResponse {
  configs: OpenCodeConfig[]
  defaultConfig: OpenCodeConfig | null
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
const CMD_KEY = isMac ? 'Cmd' : 'Ctrl'

export const DEFAULT_KEYBOARD_SHORTCUTS: Record<string, string> = {
  submit: `${CMD_KEY}+Enter`,
  abort: 'Escape',
  toggleMode: 'Tab',
  undo: `${CMD_KEY}+Z`,
  redo: `${CMD_KEY}+Shift+Z`,
  compact: `${CMD_KEY}+K`,
  fork: `${CMD_KEY}+Shift+F`,
  settings: `${CMD_KEY}+,`,
  sessions: `${CMD_KEY}+S`,
  newSession: `${CMD_KEY}+N`,
  closeSession: `${CMD_KEY}+W`,
  toggleSidebar: `${CMD_KEY}+B`,
  selectModel: `${CMD_KEY}+M`,
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'dark',
  mode: 'build',
  autoScroll: true,
  showReasoning: false,
  expandToolCalls: false,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  customCommands: [],
  customAgents: [],
  gitToken: undefined,
  tts: DEFAULT_TTS_CONFIG,
}
