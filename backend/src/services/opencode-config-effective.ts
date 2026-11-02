import path from 'path'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  openCodeLocation,
  type OpenCodeApi,
  type OpenCodeConfigInfo,
} from '@opencode-manager/shared/opencode'
import { mergeOpenCodeConfigValues } from './opencode-config-file'

interface ManagedConfigSource {
  path: string
}

export async function readManagedOpenCodeConfig(
  api: OpenCodeApi,
  sources: ReadonlyArray<ManagedConfigSource>,
): Promise<OpenCodeConfigInfo> {
  const entries = await api.config.get(openCodeLocation(getWorkspacePath()))
  const infoByPath = new Map<string, Record<string, unknown>>()

  for (const entry of entries) {
    if (entry.type !== 'document' || !entry.path) continue
    infoByPath.set(path.resolve(entry.path), entry.info as Record<string, unknown>)
  }

  const merged = sources.reduce<Record<string, unknown>>((current, source) => {
    const info = infoByPath.get(path.resolve(source.path))
    return info ? mergeOpenCodeConfigValues(current, info) : current
  }, {})

  return merged as OpenCodeConfigInfo
}
