import { DEFAULT_OPENCODE_CONFIG_SOURCE_NAME, isOpenCodeConfigSourceName } from '@opencode-manager/shared'
import type { OpenCodeConfigFile, OpenCodeConfigSourceFile, OpenCodeConfigSourceName } from '@/api/types/settings'

function sourceNameFromPath(path: string): OpenCodeConfigSourceName {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return isOpenCodeConfigSourceName(fileName) ? fileName : DEFAULT_OPENCODE_CONFIG_SOURCE_NAME
}

export function makeOpenCodeConfigSource(
  overrides: Partial<OpenCodeConfigSourceFile> = {},
): OpenCodeConfigSourceFile {
  return {
    name: 'opencode.json',
    path: '/workspace/.config/opencode/opencode.json',
    rawContent: '{}',
    content: {},
    isValid: true,
    updatedAt: 1,
    ...overrides,
  }
}

export function makeOpenCodeConfigFile(overrides: Partial<OpenCodeConfigFile> = {}): OpenCodeConfigFile {
  const base: OpenCodeConfigFile = {
    path: '/workspace/.config/opencode/opencode.json',
    content: {},
    rawContent: '{}',
    isValid: true,
    updatedAt: 1,
    revision: 'rev-1',
    sources: [],
  }
  const merged = { ...base, ...overrides }
  return {
    ...merged,
    sources: overrides.sources ?? [makeOpenCodeConfigSource({
      name: sourceNameFromPath(merged.path),
      path: merged.path,
      rawContent: merged.rawContent,
      content: merged.content,
      isValid: merged.isValid,
      validationIssues: merged.validationIssues,
      updatedAt: merged.updatedAt,
    })],
  }
}
