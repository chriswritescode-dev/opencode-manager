import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { parseJsonc } from '@opencode-manager/shared/utils'
import type { OpenCodeConfigFile, OpenCodeConfigInput } from '../types/settings'
import { normalizeOpenCodeConfigContent, readOpenCodeConfigFile, withOpenCodeConfigLock, writeOpenCodeConfigFile } from './opencode-config-file'
import { patchConfigWithRecovery, type PatchConfigValidationIssue } from './opencode/config-recovery'
import type { OpenCodeClient } from './opencode/client'
import { opencodeServerManager } from './opencode-single-server'
import type { SettingsService } from './settings'

export type ApplyOpenCodeConfigResult =
  | { status: 'restart_pending'; config: OpenCodeConfigFile }
  | { status: 'applied'; config: OpenCodeConfigFile; removedFields: string[] }
  | { status: 'rejected'; error: string; validationIssues: PatchConfigValidationIssue[]; removedFields: string[] }

export interface ApplyOpenCodeConfigInput {
  content: OpenCodeConfigInput | string
  openCodeClient: OpenCodeClient
  settingsService: SettingsService
  userId?: string
}

function didConfigFieldChange(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
  field: string,
): boolean {
  return JSON.stringify(previous?.[field]) !== JSON.stringify(next?.[field])
}

export function needsOpenCodeRestart(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): boolean {
  return ['agent', 'plugin', 'skills', 'provider'].some((field) => didConfigFieldChange(previous, next, field))
}

export function toOpenCodeConfigApplyResponse(
  result: ApplyOpenCodeConfigResult,
): { status: 200 | 400; body: Record<string, unknown> } {
  if (result.status === 'restart_pending') {
    return { status: 200, body: { ...result.config, restartRequired: true } }
  }

  if (result.status === 'applied') {
    return {
      status: 200,
      body: result.removedFields.length > 0
        ? { ...result.config, removedFields: result.removedFields }
        : { ...result.config },
    }
  }

  return {
    status: 400,
    body: {
      error: 'Config validation failed',
      details: result.error,
      validationIssues: result.validationIssues,
      removedFields: result.removedFields,
    },
  }
}

export async function applyOpenCodeConfigUpdate(
  input: ApplyOpenCodeConfigInput,
): Promise<ApplyOpenCodeConfigResult> {
  return withOpenCodeConfigLock(async () => {
    const { content, openCodeClient, settingsService, userId } = input

    const rawContent = normalizeOpenCodeConfigContent(content)
    const nextContent = OpenCodeConfigSchema.parse(parseJsonc(rawContent))

    const previous = await readOpenCodeConfigFile()
    if (previous?.isValid) {
      settingsService.saveLastKnownGoodConfig(previous.rawContent, userId)
    }

    if (needsOpenCodeRestart(previous?.content, nextContent)) {
      const config = await writeOpenCodeConfigFile(rawContent)
      opencodeServerManager.markRestartPending()
      return { status: 'restart_pending', config }
    }

    const patchResult = await patchConfigWithRecovery(openCodeClient, nextContent)
    if (!patchResult.success) {
      return {
        status: 'rejected',
        error: patchResult.error ?? 'Config validation failed',
        validationIssues: patchResult.details ?? [],
        removedFields: patchResult.removedFields ?? [],
      }
    }

    const removedFields = patchResult.removedFields ?? []
    const contentToWrite = removedFields.length > 0
      ? JSON.stringify(patchResult.appliedConfig ?? nextContent, null, 2)
      : rawContent
    const config = await writeOpenCodeConfigFile(contentToWrite)

    return { status: 'applied', config, removedFields }
  })
}
