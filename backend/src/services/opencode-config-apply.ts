import { isDeepStrictEqual } from 'node:util'
import type {
  OpenCodeConfigFile,
  OpenCodeConfigSourceName,
} from '../types/settings'
import {
  buildOpenCodeConfigSeedSnapshot,
  readOpenCodeConfigFile,
  readOpenCodeConfigSnapshot,
  restoreOpenCodeConfigSnapshot,
  serializeOpenCodeConfigSnapshot,
  updateOpenCodeConfigFile,
  withOpenCodeConfigLock,
} from './opencode-config-file'
import { opencodeServerManager } from './opencode-single-server'
import { reloadOpenCodeConfig } from './opencode-restart'
import type { OpenCodeClient } from './opencode/client'
import type { SettingsService } from './settings'
import { logger } from '../utils/logger'

export type OpenCodeReloadOutcome = 'reloaded' | 'restart_pending'

export type ApplyOpenCodeConfigResult =
  | { status: 'applied'; config: OpenCodeConfigFile }
  | { status: 'reloaded'; config: OpenCodeConfigFile }
  | { status: 'restart_pending'; config: OpenCodeConfigFile }

export interface ApplyOpenCodeConfigInput {
  content: Record<string, unknown> | string
  source?: OpenCodeConfigSourceName
  expectedRevision?: string
  settingsService: SettingsService
  openCodeClient: OpenCodeClient
}

const MCP_CONFIG_KEY = 'mcp'

export async function captureLastKnownGoodOpenCodeConfig(settingsService: SettingsService): Promise<OpenCodeConfigFile | null> {
  const previous = await readOpenCodeConfigFile()
  if (previous?.isValid) {
    settingsService.saveLastKnownGoodConfig(serializeOpenCodeConfigSnapshot(previous))
  }
  return previous
}

export async function restoreLastKnownGoodOpenCodeConfig(settingsService: SettingsService): Promise<OpenCodeConfigFile | null> {
  const lastGood = settingsService.getLastKnownGoodConfig()
  if (!lastGood) {
    return null
  }

  const config = await withOpenCodeConfigLock(() => restoreOpenCodeConfigSnapshot(lastGood))
  opencodeServerManager.clearStartupError()
  return config
}

export async function seedOpenCodeConfigFile(): Promise<OpenCodeConfigFile> {
  return withOpenCodeConfigLock(async () => {
    const config = await restoreOpenCodeConfigSnapshot(buildOpenCodeConfigSeedSnapshot())
    if (!config) {
      throw new Error('Failed to seed OpenCode config')
    }
    return config
  })
}

export function toOpenCodeConfigApplyResponse(
  result: ApplyOpenCodeConfigResult,
): { status: 200; body: Record<string, unknown> } {
  return {
    status: 200,
    body: result.status === 'restart_pending'
      ? { ...result.config, restartRequired: true }
      : { ...result.config },
  }
}

export async function reloadOpenCodeOrMarkRestartPending(openCodeClient: OpenCodeClient): Promise<OpenCodeReloadOutcome> {
  try {
    await reloadOpenCodeConfig(openCodeClient)
    return 'reloaded'
  } catch (error) {
    logger.warn('OpenCode configuration reload failed, marking a server restart as pending:', error)
    opencodeServerManager.markRestartPending()
    return 'restart_pending'
  }
}

function listChangedTopLevelKeys(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  return [...keys].filter((key) => !isDeepStrictEqual(previous[key], next[key]))
}

function requiresOpenCodeReload(previous: OpenCodeConfigFile | null, next: OpenCodeConfigFile): boolean {
  if (previous?.isValid !== next.isValid) {
    return true
  }
  return listChangedTopLevelKeys(previous?.content ?? {}, next.content).some((key) => key !== MCP_CONFIG_KEY)
}

export async function applyOpenCodeConfigUpdate(
  input: ApplyOpenCodeConfigInput,
): Promise<ApplyOpenCodeConfigResult> {
  const { reloadRequired, config } = await withOpenCodeConfigLock(async () => {
    const { content, source, expectedRevision, settingsService } = input

    const snapshot = await readOpenCodeConfigSnapshot()
    const previous = await readOpenCodeConfigFile(snapshot)

    const next = await updateOpenCodeConfigFile(content, { source, expectedRevision, snapshot })

    if (previous?.isValid) {
      const snapshot = serializeOpenCodeConfigSnapshot(previous)
      try {
        settingsService.saveLastKnownGoodConfig(snapshot)
      } catch (error) {
        await restoreOpenCodeConfigSnapshot(snapshot)
        throw error
      }
    }

    return { reloadRequired: requiresOpenCodeReload(previous, next), config: next }
  })

  if (!reloadRequired) {
    return { status: 'applied', config }
  }

  return { status: await reloadOpenCodeOrMarkRestartPending(input.openCodeClient), config }
}
