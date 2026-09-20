import path from 'path'
import { isDeepStrictEqual } from 'node:util'
import type {
  OpenCodeConfigFile,
  OpenCodeConfigSourceFile,
  OpenCodeConfigSourceName,
} from '../types/settings'
import {
  OPENCODE_CONFIG_SEED,
  getOpenCodeConfigDirectory,
  parseOpenCodeConfigContent,
  readOpenCodeConfigFile,
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

function buildOpenCodeConfigSeedSnapshot(): string {
  const sourcePath = path.join(getOpenCodeConfigDirectory(), 'opencode.jsonc')
  const content = parseOpenCodeConfigContent(OPENCODE_CONFIG_SEED).content
  const updatedAt = Date.now()
  const source: OpenCodeConfigSourceFile = {
    name: 'opencode.jsonc',
    path: sourcePath,
    rawContent: OPENCODE_CONFIG_SEED,
    content,
    isValid: true,
    updatedAt,
  }
  return serializeOpenCodeConfigSnapshot({ ...source, sources: [source] })
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

export async function applyOpenCodeConfigUpdate(
  input: ApplyOpenCodeConfigInput,
): Promise<ApplyOpenCodeConfigResult> {
  return withOpenCodeConfigLock(async () => {
    const { content, source, expectedRevision, settingsService } = input

    const previous = await readOpenCodeConfigFile()

    const next = await updateOpenCodeConfigFile(content, { source, expectedRevision })

    if (previous?.isValid) {
      const snapshot = serializeOpenCodeConfigSnapshot(previous)
      try {
        settingsService.saveLastKnownGoodConfig(snapshot)
      } catch (error) {
        await restoreOpenCodeConfigSnapshot(snapshot)
        throw error
      }
    }

    if (!isDeepStrictEqual(previous?.content ?? {}, next.content) || previous?.isValid !== next.isValid) {
      opencodeServerManager.markRestartPending()
      return { status: 'restart_pending', config: next }
    }

    return { status: 'applied', config: next }
  })
}
