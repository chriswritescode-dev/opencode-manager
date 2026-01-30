import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execSync } from 'child_process'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    getVersion: vi.fn(),
    fetchVersion: vi.fn(),
    reloadConfig: vi.fn(),
    restart: vi.fn(),
    clearStartupError: vi.fn(),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../src/constants', () => ({
  DEFAULT_AGENTS_MD: '# Test Agents MD',
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  })),
}))

vi.mock('../../src/services/file-operations', () => ({
  writeFileContent: vi.fn(),
  readFileContent: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock('../../src/services/proxy', () => ({
  patchOpenCodeConfig: vi.fn(),
  proxyToOpenCodeWithDirectory: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getOpenCodeConfigFilePath: vi.fn(() => '/test/config.json'),
  getAgentsMdPath: vi.fn(() => '/test/AGENTS.md'),
  getWorkspacePath: vi.fn(() => '/test/workspace'),
  getReposPath: vi.fn(() => '/test/repos'),
  getDatabasePath: vi.fn(() => '/test/db.sqlite'),
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0' },
    AUTH: { TRUSTED_ORIGINS: 'http://localhost:5173' },
    WORKSPACE: { BASE_PATH: '/test/workspace' },
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
  },
  FILE_LIMITS: {
    MAX_SIZE_BYTES: 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  },
}))

import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { createSettingsRoutes } from '../../src/routes/settings'

const mockExecSync = execSync as ReturnType<typeof vi.fn>
const mockGetVersion = opencodeServerManager.getVersion as ReturnType<typeof vi.fn>
const mockFetchVersion = opencodeServerManager.fetchVersion as ReturnType<typeof vi.fn>
const mockReloadConfig = opencodeServerManager.reloadConfig as ReturnType<typeof vi.fn>
const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>
const mockClearStartupError = opencodeServerManager.clearStartupError as ReturnType<typeof vi.fn>

describe('Settings Routes - OpenCode Upgrade', () => {
  let settingsApp: ReturnType<typeof createSettingsRoutes>
  let testDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecSync.mockReset()
    mockGetVersion.mockReset()
    mockFetchVersion.mockReset()
    mockReloadConfig.mockReset()
    mockRestart.mockReset()
    mockClearStartupError.mockReset()
    
    testDb = {} as any
    settingsApp = createSettingsRoutes(testDb)

    mockReloadConfig.mockResolvedValue(undefined)
    mockRestart.mockResolvedValue(undefined)
    mockClearStartupError.mockReturnValue(undefined)
  })

  describe('POST /opencode-upgrade', () => {
    describe('successful upgrade scenarios', () => {
      it('should upgrade OpenCode successfully and respond with success', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.1')
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.upgraded).toBe(true)
        expect(json.oldVersion).toBe('1.0.0')
        expect(json.newVersion).toBe('1.0.1')
      })

      it('should return already up to date when version unchanged', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockExecSync.mockReturnValueOnce('Already up to date\n')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.upgraded).toBe(false)
        expect(json.message).toContain('already up to date')
      })

      it('should try reloadConfig first then restart on success', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.1')
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')
        mockReloadConfig.mockResolvedValueOnce(undefined)

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        await settingsApp.fetch(req)

        expect(mockReloadConfig).toHaveBeenCalled()
        expect(mockRestart).not.toHaveBeenCalled()
      })

      it('should fall back to restart if reloadConfig fails', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.1')
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')
        mockReloadConfig.mockRejectedValueOnce(new Error('Reload failed'))

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        await settingsApp.fetch(req)

        expect(mockReloadConfig).toHaveBeenCalled()
        expect(mockRestart).toHaveBeenCalled()
      })
    })

    describe('timeout and recovery scenarios', () => {
      it('should timeout after 90 seconds and attempt server recovery', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        
        const timeoutError = new Error('Command timeout')
        ;(timeoutError as any).status = null
        mockExecSync.mockImplementationOnce(() => {
          throw timeoutError
        })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockExecSync).toHaveBeenCalledWith('opencode upgrade 2>&1', expect.objectContaining({
          timeout: 90000,
          killSignal: 'SIGKILL'
        }))
        expect(mockClearStartupError).toHaveBeenCalled()
        expect(mockRestart).toHaveBeenCalled()
        expect(res.status).toBe(400)
        expect(json).toMatchObject({
          upgraded: false,
          recovered: true,
          oldVersion: '1.0.0',
          newVersion: '1.0.0'
        })
        expect(json.error).toContain('recovered')
      })

      it('should attempt recovery when upgrade command throws non-timeout error', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockExecSync.mockImplementationOnce(() => {
          throw new Error('Network error')
        })

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockClearStartupError).toHaveBeenCalled()
        expect(mockRestart).toHaveBeenCalled()
        expect(res.status).toBe(400)
        expect(json.recovered).toBe(true)
      })

      it('should return 500 when recovery fails', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockExecSync.mockImplementationOnce(() => {
          throw new Error('Upgrade failed')
        })
        mockRestart.mockRejectedValueOnce(new Error('Restart failed'))

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(500)
        expect(json.recovered).toBe(false)
      })
    })

    describe('version handling', () => {
      it('should use fetched version when getVersion returns null', async () => {
        mockGetVersion.mockReturnValueOnce(null)
            .mockReturnValueOnce(null)
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockFetchVersion).toHaveBeenCalled()
        expect(json.oldVersion).toBe(null)
        expect(json.newVersion).toBe('1.0.1')
      })

      it('should handle both getVersion and fetchVersion returning null', async () => {
        mockGetVersion.mockReturnValueOnce(null)
          .mockReturnValueOnce(null)
        mockFetchVersion.mockResolvedValueOnce(null)
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(json.upgraded).toBe(false)
      })
    })
  })

  describe('POST /opencode-install-version', () => {
    describe('successful installation', () => {
      it('should install specific version successfully', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.5')
        mockExecSync.mockReturnValueOnce('Installed v1.0.5\n')

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.newVersion).toBe('1.0.5')
      })

      it('should prepend v to version if missing', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.5')
        mockExecSync.mockReturnValueOnce('Installed v1.0.5\n')

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        await settingsApp.fetch(req)

        expect(mockExecSync).toHaveBeenCalledWith(
          'opencode upgrade v1.0.5 2>&1',
          expect.any(Object)
        )
      })

      it('should not double prepend v to version', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.5')
        mockExecSync.mockReturnValueOnce('Installed v1.0.5\n')

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: 'v1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        await settingsApp.fetch(req)

        expect(mockExecSync).toHaveBeenCalledWith(
          'opencode upgrade v1.0.5 2>&1',
          expect.any(Object)
        )
      })
    })

    describe('timeout and recovery', () => {
      it('should timeout and recover on version install', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockExecSync.mockImplementationOnce(() => {
          throw new Error('timeout')
        })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockExecSync).toHaveBeenCalledWith(
          'opencode upgrade v1.0.5 2>&1',
          expect.objectContaining({ timeout: 90000 })
        )
        expect(mockRestart).toHaveBeenCalled()
        expect(res.status).toBe(400)
        expect(json.recovered).toBe(true)
      })
    })

    describe('validation', () => {
      it('should reject empty version', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)

        expect(res.status).toBe(400)
      })

      it('should reject missing version', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)

        expect(res.status).toBe(400)
      })
    })
  })

  describe('error scenarios - server stability', () => {
    it('should not crash when upgrade command throws unexpected error', async () => {
      mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValue('1.0.0')
      mockFetchVersion.mockResolvedValueOnce('1.0.0')
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Unexpected error')
      })
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toBeDefined()
    })

    it('should not crash when getVersion throws error during failure recovery', async () => {
      mockGetVersion.mockImplementationOnce(() => '1.0.0')
          .mockImplementationOnce(() => {
            throw new Error('GetVersion failed')
          })
      mockFetchVersion.mockResolvedValueOnce('1.0.0')
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Upgrade failed')
      })
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toBeDefined()
    })

    it('should handle fetchVersion throwing error during normal upgrade', async () => {
      mockGetVersion.mockReturnValueOnce('1.0.0')
        .mockReturnValueOnce('1.0.1')
      mockExecSync.mockReturnValueOnce('Upgrade successful\n')
      mockReloadConfig.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toBeDefined()
    })

    it('should not leave server in broken state when upgrade times out', async () => {
      mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
      mockFetchVersion.mockResolvedValueOnce('1.0.0')
      
      const timeoutError = new Error('timeout')
      ;(timeoutError as any).status = null
      mockExecSync.mockImplementationOnce(() => {
        throw timeoutError
      })
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
      expect(json.recovered).toBe(true)
    })
  })
})
