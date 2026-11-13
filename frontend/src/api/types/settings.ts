import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_STT_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_LEADER_KEY,
  DEFAULT_DIRECT_SHORTCUTS,
  BLOCKED_SERVER_ENV_KEYS,
  DEFAULT_ACTIVITY_WINDOW_MINUTES,
  ACTIVITY_WINDOW_MINUTE_OPTIONS,
  selectPreferredOpenCodeConfigSourceName,
  type TTSConfig,
  type STTConfig,
  type OpenCodeConfigFile,
  type OpenCodeConfigSourceFile,
  type OpenCodeConfigSourceName,
  type UpdateOpenCodeConfigRequest,
  type UpdateOpenCodeConfigPatchRequest,
  type SandboxPreferences,
  type SkillFileInfo,
  type CreateSkillRequest,
  type UpdateSkillRequest,
  type SkillScope,
  type InstallSkillFromGithubRequest,
  type InstallSkillResponse,
  type SettingsResponse as SharedSettingsResponse,
} from '@opencode-manager/shared'
import type {
  OpenCodeAgentConfig,
  OpenCodeManagedConfigSections,
  OpenCodeCommandConfig,
  OpenCodeProviderConfig,
  OpenCodeProviderModelConfig,
} from '@opencode-manager/shared/opencode'
import type { NotificationPreferences, Repo } from '@opencode-manager/shared/types'
import { saveFile } from '@/lib/download'

export type { TTSConfig, STTConfig, OpenCodeConfigFile, OpenCodeConfigSourceFile, OpenCodeConfigSourceName, UpdateOpenCodeConfigRequest, UpdateOpenCodeConfigPatchRequest, SandboxPreferences, NotificationPreferences, SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope, InstallSkillFromGithubRequest, InstallSkillResponse }
export type { UserPreferences, UpdateSettingsRequest, CustomCommand, GitCredential, GitIdentity, GitIdentityProfile, KeyboardShortcutAction } from '@opencode-manager/shared'
export { DEFAULT_TTS_CONFIG, DEFAULT_STT_CONFIG, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_USER_PREFERENCES, DEFAULT_LEADER_KEY, DEFAULT_DIRECT_SHORTCUTS, BLOCKED_SERVER_ENV_KEYS, DEFAULT_ACTIVITY_WINDOW_MINUTES, ACTIVITY_WINDOW_MINUTE_OPTIONS }
export { isOpenCodeConfigSourceName } from '@opencode-manager/shared'

export function getOpenCodeConfigSources(config: OpenCodeConfigFile): OpenCodeConfigSourceFile[] {
  return config.sources
}

export function getPreferredOpenCodeConfigSource(config: OpenCodeConfigFile): OpenCodeConfigSourceFile | null {
  const name = selectPreferredOpenCodeConfigSourceName(config.sources.map((source) => source.name))
  return name ? config.sources.find((source) => source.name === name) ?? null : null
}

export function downloadOpenCodeConfigSource(source: OpenCodeConfigSourceFile): void {
  const blob = new Blob([source.rawContent], { type: 'application/json' })
  void saveFile(blob, source.name)
}

export type SettingsResponse = SharedSettingsResponse & { restartRequired?: boolean }

export interface OpenCodeConfigSaveResponse extends OpenCodeConfigFile {
  restartRequired?: boolean
}

export interface OpenCodeRestartResponse {
  success: boolean
  message: string
}

export interface OpenCodeImportStatus {
  configSourcePath: string | null
  configSourcePaths: string[]
  stateSourcePath: string | null
  workspaceConfigPath: string
  workspaceConfigPathsToRemove: string[]
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
    repos: Repo[]
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

export interface ManagedOpenCodeConfig {
  info: OpenCodeManagedConfigSections
}

export type OpenCodeAgentPatch = {
  [K in keyof OpenCodeAgentConfig]?: OpenCodeAgentConfig[K] | null
}

export type OpenCodeCommandPatch = {
  [K in keyof OpenCodeCommandConfig]?: OpenCodeCommandConfig[K] | null
}

export type OpenCodeProviderModelPatch = {
  [K in keyof OpenCodeProviderModelConfig]?: OpenCodeProviderModelConfig[K] | null
}

export type OpenCodeProviderPatch = {
  [K in keyof OpenCodeProviderConfig]?: K extends 'models'
    ? Record<string, OpenCodeProviderModelPatch | null> | null
    : OpenCodeProviderConfig[K] | null
}
