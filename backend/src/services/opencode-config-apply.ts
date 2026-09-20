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
import type { SettingsService } from './settings'

export type ApplyOpenCodeConfigResult =
  | { status: 'restart_pending'; config: OpenCodeConfigFile }
  | { status: 'applied'; config: OpenCodeConfigFile }

export interface ApplyOpenCodeConfigInput {
  content: Record<string, unknown> | string
  source?: OpenCodeConfigSourceName
  expectedRevision?: string
  settingsService: SettingsService
}

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

function requiresOpenCodeRestart(previous: OpenCodeConfigFile | null, next: OpenCodeConfigFile): boolean {
  if (previous?.isValid !== next.isValid) {
    return true
  }

  const previousContent = previous?.content ?? {}
  const keys = new Set([...Object.keys(previousContent), ...Object.keys(next.content)])
  for (const key of keys) {
    if (!isDeepStrictEqual(previousContent[key], next.content[key]) && key !== 'mcp') {
      return true
    }
  }

  return false
}

export async function applyOpenCodeConfigUpdate(
  input: ApplyOpenCodeConfigInput,
): Promise<ApplyOpenCodeConfigResult> {
  return withOpenCodeConfigLock(async () => {
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

    if (requiresOpenCodeRestart(previous, next)) {
      opencodeServerManager.markRestartPending()
      return { status: 'restart_pending', config: next }
    }

    return { status: 'applied', config: next }
  })
}
