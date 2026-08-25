import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
  })),
}))

import { SettingsService, DEFAULT_SEED_OPENCODE_CONFIG } from '../../src/services/settings'

describe('SettingsService - upsertDefaultOpenCodeConfig', () => {
  let settingsService: SettingsService
  let mockGetOpenCodeConfigByName: ReturnType<typeof vi.fn>
  let mockUpdateOpenCodeConfig: ReturnType<typeof vi.fn>
  let mockCreateOpenCodeConfig: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    settingsService = new SettingsService({ query: vi.fn() } as unknown as Database)
    mockGetOpenCodeConfigByName = vi.fn()
    mockUpdateOpenCodeConfig = vi.fn()
    mockCreateOpenCodeConfig = vi.fn()
    vi.spyOn(settingsService, 'getOpenCodeConfigByName').mockImplementation(mockGetOpenCodeConfigByName)
    vi.spyOn(settingsService, 'updateOpenCodeConfig').mockImplementation(mockUpdateOpenCodeConfig)
    vi.spyOn(settingsService, 'createOpenCodeConfig').mockImplementation(mockCreateOpenCodeConfig)
  })

  it('updates the default config when a default row already exists', () => {
    mockGetOpenCodeConfigByName.mockReturnValue({ name: 'default' })
    mockUpdateOpenCodeConfig.mockReturnValue({ name: 'default', isDefault: true })

    const result = settingsService.upsertDefaultOpenCodeConfig('{"$schema":"https://opencode.ai/config.json"}')

    expect(mockUpdateOpenCodeConfig).toHaveBeenCalledWith('default', {
      content: '{"$schema":"https://opencode.ai/config.json"}',
      isDefault: true,
    }, 'default')
    expect(mockCreateOpenCodeConfig).not.toHaveBeenCalled()
    expect(result.isDefault).toBe(true)
  })

  it('creates the default config when no default row exists', () => {
    mockGetOpenCodeConfigByName.mockReturnValue(null)
    mockCreateOpenCodeConfig.mockReturnValue({ name: 'default', isDefault: true })

    const result = settingsService.upsertDefaultOpenCodeConfig('{"$schema":"https://opencode.ai/config.json"}')

    expect(mockCreateOpenCodeConfig).toHaveBeenCalledWith({
      name: 'default',
      content: '{"$schema":"https://opencode.ai/config.json"}',
      isDefault: true,
    }, 'default')
    expect(mockUpdateOpenCodeConfig).not.toHaveBeenCalled()
    expect(result.isDefault).toBe(true)
  })

  it('seeds a default config row marked isDefault when no config exists (index seed path)', () => {
    expect(JSON.parse(DEFAULT_SEED_OPENCODE_CONFIG)).toEqual({ $schema: 'https://opencode.ai/config.json' })

    mockGetOpenCodeConfigByName.mockReturnValue(null)
    mockCreateOpenCodeConfig.mockReturnValue({ name: 'default', isDefault: true })

    const result = settingsService.upsertDefaultOpenCodeConfig(DEFAULT_SEED_OPENCODE_CONFIG)

    expect(mockCreateOpenCodeConfig).toHaveBeenCalledWith({
      name: 'default',
      content: DEFAULT_SEED_OPENCODE_CONFIG,
      isDefault: true,
    }, 'default')
    expect(result.name).toBe('default')
    expect(result.isDefault).toBe(true)
  })
})
