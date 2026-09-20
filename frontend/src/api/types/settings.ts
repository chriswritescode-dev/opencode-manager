import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_STT_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_LEADER_KEY,
  BLOCKED_SERVER_ENV_KEYS,
  DEFAULT_SERVER_ENV_VARS,
  OPENCODE_CONFIG_SOURCE_NAMES,
  type TTSConfig,
  type STTConfig,
  type OpenCodeConfigFile,
  type OpenCodeConfigSourceFile,
  type OpenCodeConfigSourceName,
  type UpdateOpenCodeConfigRequest,
  type ModelConfig,
  type ProviderConfig,
  type SandboxPreferences,
  type SkillFileInfo,
  type CreateSkillRequest,
  type UpdateSkillRequest,
  type SkillScope,
  type InstallSkillFromGithubRequest,
  type InstallSkillResponse,
} from '@opencode-manager/shared'
import type { NotificationPreferences } from '@opencode-manager/shared/types'
import { saveFile } from '@/lib/download'

export type { TTSConfig, STTConfig, OpenCodeConfigFile, OpenCodeConfigSourceFile, OpenCodeConfigSourceName, UpdateOpenCodeConfigRequest, ModelConfig, ProviderConfig, SandboxPreferences, NotificationPreferences, SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope, InstallSkillFromGithubRequest, InstallSkillResponse }
export { DEFAULT_TTS_CONFIG, DEFAULT_STT_CONFIG, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_USER_PREFERENCES, DEFAULT_LEADER_KEY, BLOCKED_SERVER_ENV_KEYS, DEFAULT_SERVER_ENV_VARS }

export type OpenCodeConfigSource = OpenCodeConfigSourceFile

export function isOpenCodeConfigSourceName(value: string): value is OpenCodeConfigSourceName {
  return (OPENCODE_CONFIG_SOURCE_NAMES as readonly string[]).includes(value)
}

function sourceNameFromPath(path: string): OpenCodeConfigSourceName {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return isOpenCodeConfigSourceName(fileName) ? fileName : 'opencode.jsonc'
}

export function getOpenCodeConfigSources(config: OpenCodeConfigFile): OpenCodeConfigSource[] {
  if (config.sources && config.sources.length > 0) return config.sources
  return [{
    name: sourceNameFromPath(config.path),
    path: config.path,
    rawContent: config.rawContent,
    content: config.content,
    isValid: config.isValid,
    validationIssues: config.validationIssues,
    updatedAt: config.updatedAt,
  }]
}

export function getPreferredOpenCodeConfigSource(config: OpenCodeConfigFile): OpenCodeConfigSource | null {
  const sources = getOpenCodeConfigSources(config)
  return sources.find((source) => source.name === 'opencode.jsonc')
    ?? sources.find((source) => source.name === 'opencode.json')
    ?? sources.find((source) => source.name === 'config.json')
    ?? sources[0]
    ?? null
}

export function downloadOpenCodeConfigSource(source: OpenCodeConfigSource): void {
  const blob = new Blob([source.rawContent], { type: 'application/json' })
  void saveFile(blob, source.name)
}

export interface CustomCommand {
  name: string
  description: string
  promptTemplate: string
}

export interface GitCredential {
  id?: string
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
  defaultGitCredentialId?: string
  gitIdentity?: GitIdentity
  tts?: TTSConfig
  stt?: STTConfig
  notifications?: NotificationPreferences
  repoOrder?: number[]
  repoSortMode?: 'recent' | 'manual' | 'name'
  serverEnvVars?: Array<{ key: string; value: string }>
  disabledDefaultServerEnvVars?: string[]
  sandbox?: SandboxPreferences
}

export interface SettingsResponse {
  preferences: UserPreferences
  updatedAt: number
  restartRequired?: boolean
}

export interface UpdateSettingsRequest {
  preferences: Partial<UserPreferences>
}

export interface OpenCodeConfigSaveResponse extends OpenCodeConfigFile {
  restartRequired?: boolean
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

export interface OpenCodeDirectoryFileInfo {
  kind: 'agents' | 'commands'
  name: string
  relativePath: string
}
