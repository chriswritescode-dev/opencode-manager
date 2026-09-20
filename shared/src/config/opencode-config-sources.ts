import { OPENCODE_CONFIG_SOURCE_NAMES, type OpenCodeConfigSourceName } from './defaults'

export const DEFAULT_OPENCODE_CONFIG_SOURCE_NAME: OpenCodeConfigSourceName = 'opencode.jsonc'

export function isOpenCodeConfigSourceName(value: string): value is OpenCodeConfigSourceName {
  return (OPENCODE_CONFIG_SOURCE_NAMES as readonly string[]).includes(value)
}

export function selectPreferredOpenCodeConfigSourceName(
  names: readonly OpenCodeConfigSourceName[],
): OpenCodeConfigSourceName | null {
  const present = new Set(names)
  for (const name of [...OPENCODE_CONFIG_SOURCE_NAMES].reverse()) {
    if (present.has(name)) return name
  }
  return null
}
