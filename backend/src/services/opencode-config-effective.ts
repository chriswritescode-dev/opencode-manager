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

/**
 * Reads the configuration documents OpenCode has loaded for a directory,
 * keyed by each document's resolved file path.
 */
export async function readOpenCodeConfigDocuments(
  api: OpenCodeApi,
  directory: string,
): Promise<Map<string, OpenCodeConfigInfo>> {
  const entries = await api.config.get(openCodeLocation(directory))
  const infoByPath = new Map<string, OpenCodeConfigInfo>()

  for (const entry of entries) {
    if (entry.type !== 'document' || !entry.path) continue
    infoByPath.set(path.resolve(entry.path), entry.info)
  }

  return infoByPath
}

export async function readManagedOpenCodeConfig(
  api: OpenCodeApi,
  sources: ReadonlyArray<ManagedConfigSource>,
): Promise<OpenCodeConfigInfo> {
  const infoByPath = await readOpenCodeConfigDocuments(api, getWorkspacePath())

  const merged = sources.reduce<Record<string, unknown>>((current, source) => {
    const info = infoByPath.get(path.resolve(source.path))
    return info ? mergeOpenCodeConfigValues(current, info as Record<string, unknown>) : current
  }, {})

  return merged as OpenCodeConfigInfo
}
