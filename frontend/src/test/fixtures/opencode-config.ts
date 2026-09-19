import type { OpenCodeConfigFile } from '@/api/types/settings'

export function makeOpenCodeConfigFile(overrides: Partial<OpenCodeConfigFile> = {}): OpenCodeConfigFile {
  return {
    path: '/workspace/.config/opencode/opencode.json',
    content: {},
    rawContent: '{}',
    isValid: true,
    updatedAt: 1,
    ...overrides,
  }
}
