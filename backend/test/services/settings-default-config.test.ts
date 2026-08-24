import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
  })),
}))

import { SettingsService } from '../../src/services/settings'

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
})
