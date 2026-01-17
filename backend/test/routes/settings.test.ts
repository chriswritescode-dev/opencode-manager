import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSettingsRoutes } from '../../src/routes/settings'
import type { Hono } from 'hono'
import { spawn } from 'child_process'
import { mkdir, rm } from 'fs/promises'

const mockSettingsService = {
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  resetSettings: vi.fn(),
  getOpenCodeConfigs: vi.fn(),
  createOpenCodeConfig: vi.fn(),
  updateOpenCodeConfig: vi.fn(),
  deleteOpenCodeConfig: vi.fn(),
  setDefaultOpenCodeConfig: vi.fn(),
  getDefaultOpenCodeConfig: vi.fn(),
  saveLastKnownGoodConfig: vi.fn(),
  rollbackToLastKnownGoodHealth: vi.fn(),
  deleteFilesystemConfig: vi.fn(),
}

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => ({
    run: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn()
    }))
  })),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => mockSettingsService),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    getVersion: vi.fn(),
    fetchVersion: vi.fn(),
    clearStartupError: vi.fn(),
    restart: vi.fn(),
  },
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  rm: vi.fn(),
}))

describe('Settings Routes', () => {
  let app: Hono
  let mockDatabase: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = {}
    Object.keys(mockSettingsService).forEach(key => {
      (mockSettingsService as any)[key].mockClear()
    })
    app = createSettingsRoutes(mockDatabase as any)
  })

  describe('POST /test-credential', () => {
    const validCredential = {
      name: 'test-cred',
      host: 'github.com',
      token: 'ghp_test_token_123',
    }

    it('should return 400 for invalid request body', async () => {
      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('details')
    })

    it('should return 400 for missing required fields', async () => {
      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('details')
    })

    it('should return 400 for empty strings', async () => {
      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', host: '', token: '' }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('details')
    })

    it('should handle GitHub.com authentication successfully', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(0)
        }),
        stderr: {
          on: vi.fn(),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validCredential),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(body).toHaveProperty('maskedToken')
      expect(body.maskedToken).toBe('ghp_test...')
    })

    it('should handle GitLab.com authentication with default username', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(0)
        }),
        stderr: {
          on: vi.fn(),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validCredential,
          host: 'gitlab.com',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(body).toHaveProperty('maskedToken')
    })

    it('should handle custom username', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(0)
        }),
        stderr: {
          on: vi.fn(),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validCredential,
          username: 'custom-user',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
    })

    it('should return 400 when git authentication fails', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(128) // Git auth failure exit code
        }),
        stderr: {
          on: vi.fn().mockImplementation((event, callback) => {
            callback('Authentication failed for repository')
          }),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validCredential),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('success', false)
      expect(body).toHaveProperty('error')
    })

    it('should return 500 when git process throws error', async () => {
      spawn.mockImplementation(() => {
        throw new Error('Spawn failed')
      })

      mkdir.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validCredential),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('success', false)
      expect(body).toHaveProperty('error')
    })

    it('should handle hosts with trailing slashes', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(0)
        }),
        stderr: {
          on: vi.fn(),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validCredential,
          host: 'github.com/',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
    })

    it('should handle invalid URLs gracefully', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(0)
        }),
        stderr: {
          on: vi.fn(),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validCredential,
          host: 'not-a-valid-url',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
    })

    it('should mask tokens correctly', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(0)
        }),
        stderr: {
          on: vi.fn(),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validCredential,
          token: 'ghp_very_long_token_that_should_be_masked_properly',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(body.maskedToken).toBe('ghp_very...')
    })

    it('should handle very short tokens', async () => {
      spawn.mockReturnValue({
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') callback(0)
        }),
        stderr: {
          on: vi.fn(),
        },
      } as any)

      mkdir.mockResolvedValueOnce(undefined)
      rm.mockResolvedValueOnce(undefined)

      const response = await app.request('/test-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validCredential,
          token: 'short',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(body.maskedToken).toBe('*******')
    })
  })
})