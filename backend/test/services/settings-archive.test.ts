import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
  })),
}))

import { SettingsService } from '../../src/services/settings'

describe('SettingsService - archiveBrokenConfig', () => {
  let settingsService: SettingsService
  let mockGetDefaultConfig: ReturnType<typeof vi.fn>
  let mockCreateOpenCodeConfig: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    settingsService = new SettingsService({ query: vi.fn() } as unknown as Database)
    mockGetDefaultConfig = vi.fn()
    mockCreateOpenCodeConfig = vi.fn()
    vi.spyOn(settingsService, 'getDefaultOpenCodeConfig').mockImplementation(mockGetDefaultConfig)
    vi.spyOn(settingsService, 'createOpenCodeConfig').mockImplementation(mockCreateOpenCodeConfig)
  })

  it('creates a broken config backup with default-broken prefix', () => {
    const defaultConfig = {
      id: 1,
      name: 'default',
      rawContent: '{"$schema": "https://opencode.ai/config.json"}',
      isValid: true,
      content: { '$schema': 'https://opencode.ai/config.json' },
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    mockGetDefaultConfig.mockReturnValue(defaultConfig)
    mockCreateOpenCodeConfig.mockReturnValue({
      ...defaultConfig,
      id: 2,
      name: 'default-broken-2026-04-25T00-00-00-000Z',
      isDefault: false,
    })

    const backupName = settingsService.archiveBrokenConfig()

    expect(backupName).toMatch(/^default-broken-/)
    expect(mockCreateOpenCodeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^default-broken-/),
        content: defaultConfig.rawContent,
        isDefault: false,
      }),
      'default',
      { suppressAutoDefault: true },
    )
  })

  it('returns null when no default config exists', () => {
    mockGetDefaultConfig.mockReturnValue(null)

    const result = settingsService.archiveBrokenConfig()

    expect(result).toBeNull()
    expect(mockCreateOpenCodeConfig).not.toHaveBeenCalled()
  })
})
