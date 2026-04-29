import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
  })),
}))

vi.mock('../../src/utils/crypto', () => ({
  encryptSecret: vi.fn((plaintext) => `encrypted:${plaintext}`),
  decryptSecret: vi.fn((encrypted) => {
    if (encrypted.startsWith('encrypted:')) {
      return encrypted.slice(10)
    }
    throw new Error('Invalid encrypted data format')
  }),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    OPENCODE: {
      SERVER_PASSWORD: 'env_password',
      SERVER_USERNAME: 'opencode',
    },
  },
}))

import { SettingsService } from '../../src/services/settings'

describe('SettingsService - system settings', () => {
  let settingsService: SettingsService
  let mockGet: ReturnType<typeof vi.fn>
  let mockRun: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGet = vi.fn()
    mockRun = vi.fn()
    const mockDb = {
      query: vi.fn((sql: string) => {
        if (sql.includes('SELECT')) {
          return { get: mockGet }
        }
        return { run: mockRun }
      }),
    } as unknown as Database
    settingsService = new SettingsService(mockDb)
  })

  describe('getSystemSetting', () => {
    it('returns the value when key exists', () => {
      mockGet.mockReturnValue({ value: 'test-value' })

      const result = settingsService.getSystemSetting('test.key')

      expect(result).toBe('test-value')
      expect(mockGet).toHaveBeenCalledWith('test.key')
    })

    it('returns undefined when key does not exist', () => {
      mockGet.mockReturnValue(undefined)

      const result = settingsService.getSystemSetting('nonexistent')

      expect(result).toBeUndefined()
    })
  })

  describe('setSystemSetting', () => {
    it('inserts or updates the setting', () => {
      settingsService.setSystemSetting('test.key', 'test-value')

      expect(mockRun).toHaveBeenCalledWith(
        'test.key',
        'test-value',
        expect.any(Number),
      )
    })
  })

  describe('deleteSystemSetting', () => {
    it('deletes the setting by key', () => {
      settingsService.deleteSystemSetting('test.key')

      expect(mockRun).toHaveBeenCalledWith('test.key')
    })
  })

  describe('getOpenCodeServerPassword', () => {
    it('returns decrypted stored password when present', () => {
      mockGet.mockReturnValue({ value: 'encrypted:stored_password' })

      const result = settingsService.getOpenCodeServerPassword()

      expect(result).toBe('stored_password')
    })

    it('falls back to env password when no stored password', () => {
      mockGet.mockReturnValue(undefined)

      const result = settingsService.getOpenCodeServerPassword()

      expect(result).toBe('env_password')
    })

    it('falls back to env password when decrypt fails', () => {
      mockGet.mockReturnValue({ value: 'invalid_encrypted' })

      const result = settingsService.getOpenCodeServerPassword()

      expect(result).toBe('env_password')
    })
  })

  describe('hasConfiguredOpenCodeServerPassword', () => {
    it('returns true when stored password exists and is valid', () => {
      mockGet.mockReturnValue({ value: 'encrypted:stored_password' })

      const result = settingsService.hasConfiguredOpenCodeServerPassword()

      expect(result).toBe(true)
    })

    it('returns false when no stored password', () => {
      mockGet.mockReturnValue(undefined)

      const result = settingsService.hasConfiguredOpenCodeServerPassword()

      expect(result).toBe(false)
    })

    it('returns false when decrypt fails', () => {
      mockGet.mockReturnValue({ value: 'invalid' })

      const result = settingsService.hasConfiguredOpenCodeServerPassword()

      expect(result).toBe(false)
    })
  })

  describe('setOpenCodeServerPassword', () => {
    it('encrypts and stores the password', () => {
      settingsService.setOpenCodeServerPassword('new_password')

      expect(mockRun).toHaveBeenCalledWith(
        'opencode.serverPassword',
        'encrypted:new_password',
        expect.any(Number),
      )
    })
  })

  describe('clearOpenCodeServerPassword', () => {
    it('deletes the stored password', () => {
      settingsService.clearOpenCodeServerPassword()

      expect(mockRun).toHaveBeenCalledWith('opencode.serverPassword')
    })
  })
})
