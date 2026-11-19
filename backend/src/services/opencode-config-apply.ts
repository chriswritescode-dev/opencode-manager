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
  type OpenCodeConfigContent,
  type OpenCodeConfigSnapshot,
  type OpenCodeConfigUpdateMode,
  withOpenCodeConfigLock,
} from './opencode-config-file'
import { z } from 'zod'
import { JsonObjectSchema, parseJsonObject, type JsonObject } from '@opencode-manager/shared/utils'
import { readManagedOpenCodeConfig } from './opencode-config-effective'
import { patchNamesOpenCodeConfigEntities, restoreOpenCodeConfigReferences } from './opencode-config-references'
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

export interface ApplyOpenCodeConfigOptions {
  content: OpenCodeConfigContent | string
  source?: OpenCodeConfigSourceName
  expectedRevision?: string
  mode?: OpenCodeConfigUpdateMode
  settingsService: SettingsService
  openCodeClient: OpenCodeClient
  manager?: Pick<typeof opencodeServerManager, 'markRestartPending'>
}

export async function captureLastKnownGoodOpenCodeConfig(
  settingsService: Pick<SettingsService, 'saveLastKnownGoodConfig'>,
): Promise<OpenCodeConfigFile | null> {
  const previous = await readOpenCodeConfigFile()
  if (previous?.isValid) {
    settingsService.saveLastKnownGoodConfig(serializeOpenCodeConfigSnapshot(previous))
  }
  return previous
}

export async function restoreLastKnownGoodOpenCodeConfig(
  settingsService: Pick<SettingsService, 'getLastKnownGoodConfig'>,
  manager: Pick<typeof opencodeServerManager, 'clearStartupError'> = opencodeServerManager,
): Promise<OpenCodeConfigFile | null> {
  const lastGood = settingsService.getLastKnownGoodConfig()
  if (!lastGood) {
    return null
  }

  const config = await withOpenCodeConfigLock(() => restoreOpenCodeConfigSnapshot(lastGood))
  manager.clearStartupError()
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

export interface OpenCodeConfigApplyResponse {
  status: 200
  body: OpenCodeConfigFile & { restartRequired?: boolean }
}

export function toOpenCodeConfigApplyResponse(
  result: ApplyOpenCodeConfigResult,
): OpenCodeConfigApplyResponse {
  return {
    status: 200,
    body: result.status === 'restart_pending'
      ? { ...result.config, restartRequired: true }
      : { ...result.config },
  }
}

export async function reloadOpenCodeOrMarkRestartPending(
  openCodeClient: OpenCodeClient,
  manager: Pick<typeof opencodeServerManager, 'markRestartPending'> = opencodeServerManager,
): Promise<OpenCodeReloadOutcome> {
  try {
    await reloadOpenCodeConfig(openCodeClient)
    return 'reloaded'
  } catch (error) {
    logger.warn('OpenCode configuration reload failed, marking a server restart as pending:', error)
    manager.markRestartPending()
    return 'restart_pending'
  }
}

function listChangedTopLevelKeys(previous: JsonObject, next: JsonObject): string[] {
  const previousContainer = parseJsonObject(previous) ?? {}
  const nextContainer = parseJsonObject(next) ?? {}
  const keys = new Set([...Object.keys(previousContainer), ...Object.keys(nextContainer)])
  return [...keys].filter((key) => !isDeepStrictEqual(previousContainer[key], nextContainer[key]))
}

function requiresOpenCodeReload(previous: OpenCodeConfigFile | null, next: OpenCodeConfigFile): boolean {
  if (previous?.isValid !== next.isValid) {
    return true
  }
  return listChangedTopLevelKeys(previous?.content ?? {}, next.content).length > 0
}

async function keepOpenCodeConfigReferences(
  patch: JsonObject,
  snapshot: OpenCodeConfigSnapshot,
  openCodeClient: OpenCodeClient,
): Promise<JsonObject> {
  const patchContainer = parseJsonObject(patch) ?? {}
  if (!patchNamesOpenCodeConfigEntities(patchContainer)) return patchContainer
  const resolved = await readManagedOpenCodeConfig(openCodeClient.api, snapshot.sources)
  return restoreOpenCodeConfigReferences(patchContainer, resolved, snapshot.content)
}

export async function applyOpenCodeConfigUpdate(
  input: ApplyOpenCodeConfigOptions,
): Promise<ApplyOpenCodeConfigResult> {
  const { reloadRequired, config } = await withOpenCodeConfigLock(async () => {
    const { content, source, expectedRevision, mode, settingsService } = input

    const snapshot = await readOpenCodeConfigSnapshot()
    const previous = await readOpenCodeConfigFile(snapshot)
    const savedContent = mode === 'merge' && !z.string().safeParse(content).success
      ? await keepOpenCodeConfigReferences(JsonObjectSchema.parse(content), snapshot, input.openCodeClient)
      : content

    const next = await updateOpenCodeConfigFile(savedContent, { source, expectedRevision, snapshot, mode })

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

  return { status: await reloadOpenCodeOrMarkRestartPending(input.openCodeClient, input.manager), config }
}
