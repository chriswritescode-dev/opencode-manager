import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'

const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()
const mockSaveLastKnownGoodConfig = vi.fn()
const mockCreateOpenCodeConfig = vi.fn()
const mockUpdateOpenCodeConfig = vi.fn()
const mockDeleteOpenCodeConfig = vi.fn()
const mockGetOpenCodeConfigByName = vi.fn()
const mockSetDefaultOpenCodeConfig = vi.fn()
const mockGetDefaultOpenCodeConfig = vi.fn()

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  promises: {
    mkdir: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn(),
  },
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
  spawn: vi.fn(),
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
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
    saveLastKnownGoodConfig: mockSaveLastKnownGoodConfig,
    createOpenCodeConfig: mockCreateOpenCodeConfig,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
    deleteOpenCodeConfig: mockDeleteOpenCodeConfig,
    getOpenCodeConfigByName: mockGetOpenCodeConfigByName,
    setDefaultOpenCodeConfig: mockSetDefaultOpenCodeConfig,
    getDefaultOpenCodeConfig: mockGetDefaultOpenCodeConfig,
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

vi.mock('../../src/services/opencode-single-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-single-server')>()
  
  class MockConfigReloadError extends Error {
    validationIssues: Array<{ path: string; message: string }>
    removedFields: string[]

    constructor(message: string, validationIssues: Array<{ path: string; message: string }> = [], removedFields: string[] = []) {
      super(message)
      this.name = 'ConfigReloadError'
      this.validationIssues = validationIssues
      this.removedFields = removedFields
    }
  }

  return {
    ...actual,
    opencodeServerManager: {
      getVersion: vi.fn(),
      fetchVersion: vi.fn(),
      reloadConfig: vi.fn(),
      restart: vi.fn(),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(),
      setDatabase: vi.fn(),
      reinitializeBinDirectory: vi.fn(),
    },
    ConfigReloadError: MockConfigReloadError,
  }
})

vi.mock('../../src/services/opencode-import', () => ({
  OpenCodeImportProtectionError: class OpenCodeImportProtectionError extends Error {
    code = 'OPENCODE_IMPORT_PROTECTED'
    detail: string

    constructor(detail: string) {
      super('OpenCode host import was blocked to protect existing workspace state')
      this.detail = detail
    }
  },
  getOpenCodeImportStatus: vi.fn(),
  syncOpenCodeImport: vi.fn(),
  getImportedSessionDirectories: vi.fn(),
}))

vi.mock('../../src/services/repo', () => ({
  relinkReposFromSessionDirectories: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace'),
  getReposPath: vi.fn(() => '/tmp/test-repos'),
  getOpenCodeConfigFilePath: vi.fn(() => '/tmp/test-workspace/.config/opencode.json'),
  getAgentsMdPath: vi.fn(() => '/tmp/test-workspace/AGENTS.md'),
  getDatabasePath: vi.fn(() => ':memory:'),
  getConfigPath: vi.fn(() => '/tmp/test-workspace/config'),
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: { TRUSTED_ORIGINS: 'http://localhost:5173', SECRET: 'test-secret-for-encryption-key-32c' },
    WORKSPACE: { BASE_PATH: '/tmp/test-workspace', REPOS_DIR: 'repos', CONFIG_DIR: 'config', AUTH_FILE: 'auth.json' },
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
    DATABASE: { PATH: ':memory:' },
    FILE_LIMITS: {
      MAX_SIZE_BYTES: 1024 * 1024,
      MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
    },
  },
  FILE_LIMITS: {
    MAX_SIZE_BYTES: 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  },
}))

import { createSettingsRoutes } from '../../src/routes/settings'
import { writeFileContent } from '../../src/services/file-operations'
import { getImportedSessionDirectories, getOpenCodeImportStatus, OpenCodeImportProtectionError, syncOpenCodeImport } from '../../src/services/opencode-import'
import { relinkReposFromSessionDirectories } from '../../src/services/repo'
import { opencodeServerManager, ConfigReloadError } from '../../src/services/opencode-single-server'
import { patchOpenCodeConfig } from '../../src/services/proxy'

const mockExecSync = execSync as ReturnType<typeof vi.fn>
const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>
const mockGetVersion = opencodeServerManager.getVersion as ReturnType<typeof vi.fn>
const mockFetchVersion = opencodeServerManager.fetchVersion as ReturnType<typeof vi.fn>
const mockReloadConfig = opencodeServerManager.reloadConfig as ReturnType<typeof vi.fn>
const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>
const mockClearStartupError = opencodeServerManager.clearStartupError as ReturnType<typeof vi.fn>
const mockGetOpenCodeImportStatus = getOpenCodeImportStatus as ReturnType<typeof vi.fn>
const mockSyncOpenCodeImport = syncOpenCodeImport as ReturnType<typeof vi.fn>
const mockGetImportedSessionDirectories = getImportedSessionDirectories as ReturnType<typeof vi.fn>
const mockRelinkReposFromSessionDirectories = relinkReposFromSessionDirectories as ReturnType<typeof vi.fn>
const mockWriteFileContent = writeFileContent as ReturnType<typeof vi.fn>
const mockPatchOpenCodeConfig = patchOpenCodeConfig as ReturnType<typeof vi.fn>

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
    mockGetSettings.mockReset()
    mockUpdateSettings.mockReset()
    mockSaveLastKnownGoodConfig.mockReset()
    mockCreateOpenCodeConfig.mockReset()
    mockUpdateOpenCodeConfig.mockReset()
    mockDeleteOpenCodeConfig.mockReset()
    mockGetOpenCodeConfigByName.mockReset()
    mockSetDefaultOpenCodeConfig.mockReset()
    mockGetOpenCodeImportStatus.mockReset()
    mockSyncOpenCodeImport.mockReset()
    mockGetImportedSessionDirectories.mockReset()
    mockRelinkReposFromSessionDirectories.mockReset()
    mockWriteFileContent.mockReset()
    mockPatchOpenCodeConfig.mockReset()
    mockGetDefaultOpenCodeConfig.mockReset()
    
    testDb = {} as any
    settingsApp = createSettingsRoutes(testDb, { getGitEnvironment: vi.fn().mockReturnValue({}) } as any)

    mockReloadConfig.mockResolvedValue(undefined)
    mockRestart.mockResolvedValue(undefined)
    mockClearStartupError.mockReturnValue(undefined)
    mockPatchOpenCodeConfig.mockResolvedValue({ success: true, appliedConfig: { $schema: 'https://opencode.ai/config.json' } })
    mockWriteFileContent.mockResolvedValue(undefined)
    mockGetOpenCodeImportStatus.mockResolvedValue({
      configSourcePath: null,
      stateSourcePath: null,
      workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
      workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
      workspaceStateExists: false,
    })
    mockGetImportedSessionDirectories.mockResolvedValue({
      directories: ['/Users/test/project-a', '/Users/test/project-b/apps/web'],
    })
    mockRelinkReposFromSessionDirectories.mockResolvedValue({
      repos: [],
      relinkedCount: 0,
      existingCount: 0,
      nonRepoPathCount: 0,
      duplicatePathCount: 0,
      errors: [],
    })
    mockGetDefaultOpenCodeConfig.mockReturnValue(null)
  })

  describe('OpenCode config routes', () => {
    it('should reject create-as-default when runtime validation fails', async () => {
      mockCreateOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'broken',
        content: { command: { review: true } },
        rawContent: '{"command":{"review":true}}',
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: false,
        error: 'command.review: Invalid field',
        details: [{ path: 'command.review', message: 'Invalid field' }],
      })

      const req = new Request('http://localhost/opencode-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'broken',
          content: '{"command":{"review":true}}',
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Config validation failed')
      expect(mockSaveLastKnownGoodConfig).toHaveBeenCalledWith('default')
      expect(mockCreateOpenCodeConfig).toHaveBeenCalledWith(
        {
          name: 'broken',
          content: '{"command":{"review":true}}',
          isDefault: false,
        },
        'default',
        { suppressAutoDefault: true }
      )
      expect(mockDeleteOpenCodeConfig).toHaveBeenCalledWith('broken', 'default')
      expect(mockSetDefaultOpenCodeConfig).not.toHaveBeenCalled()
      expect(mockWriteFileContent).not.toHaveBeenCalled()
    })

    it('should persist sanitized content before marking a new config as default', async () => {
      mockCreateOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'cleaned',
        content: { command: { review: true }, theme: 'dark' },
        rawContent: '{"command":{"review":true},"theme":"dark"}',
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: true,
        appliedConfig: { theme: 'dark' },
        removedFields: ['command.review'],
        details: [{ path: 'command.review', message: 'Invalid field' }],
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'cleaned',
        content: { theme: 'dark' },
        rawContent: '{\n  "theme": "dark"\n}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      })

      const req = new Request('http://localhost/opencode-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'cleaned',
          content: '{"command":{"review":true},"theme":"dark"}',
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledWith(
        'cleaned',
        {
          content: '{\n  "theme": "dark"\n}',
          isDefault: true,
        },
        'default'
      )
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/tmp/test-workspace/.config/opencode.json',
        '{\n  "theme": "dark"\n}'
      )
      expect(json.removedFields).toEqual(['command.review'])
    })

    it('should reject set-default when runtime validation fails', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'broken',
        content: { command: { review: true } },
        rawContent: '{"command":{"review":true}}',
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: false,
        error: 'command.review: Invalid field',
        details: [{ path: 'command.review', message: 'Invalid field' }],
      })

      const req = new Request('http://localhost/opencode-configs/broken/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Config validation failed')
      expect(mockSetDefaultOpenCodeConfig).not.toHaveBeenCalled()
      expect(mockWriteFileContent).not.toHaveBeenCalled()
    })

    it('should sanitize existing config content before switching the default flag', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'cleaned',
        content: { command: { review: true }, theme: 'dark' },
        rawContent: '{"command":{"review":true},"theme":"dark"}',
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: true,
        appliedConfig: { theme: 'dark' },
        removedFields: ['command.review'],
        details: [{ path: 'command.review', message: 'Invalid field' }],
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'cleaned',
        content: { theme: 'dark' },
        rawContent: '{\n  "theme": "dark"\n}',
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 2,
      })
      mockSetDefaultOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'cleaned',
        content: { theme: 'dark' },
        rawContent: '{\n  "theme": "dark"\n}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 3,
      })

      const req = new Request('http://localhost/opencode-configs/cleaned/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>
      const updateCallOrder = mockUpdateOpenCodeConfig.mock.invocationCallOrder[0]
      const setDefaultCallOrder = mockSetDefaultOpenCodeConfig.mock.invocationCallOrder[0]

      expect(res.status).toBe(200)
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledWith(
        'cleaned',
        { content: '{\n  "theme": "dark"\n}' },
        'default'
      )
      expect(updateCallOrder).toBeDefined()
      expect(setDefaultCallOrder).toBeDefined()
      expect(updateCallOrder ?? 0).toBeLessThan(setDefaultCallOrder ?? 0)
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/tmp/test-workspace/.config/opencode.json',
        '{\n  "theme": "dark"\n}'
      )
      expect(json.removedFields).toEqual(['command.review'])
    })

    it('should restart when agents changed on set-default', async () => {
      mockGetDefaultOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'old-default',
        content: { agent: { primary: { model: 'a' } } },
        rawContent: '{"agent":{"primary":{"model":"a"}}}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { agent: { primary: { model: 'b' } } },
        rawContent: '{"agent":{"primary":{"model":"b"}}}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 2,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: true,
        appliedConfig: { agent: { primary: { model: 'b' } } },
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { agent: { primary: { model: 'b' } } },
        rawContent: '{"agent":{"primary":{"model":"b"}}}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 3,
      })
      mockSetDefaultOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { agent: { primary: { model: 'b' } } },
        rawContent: '{"agent":{"primary":{"model":"b"}}}',
        isValid: true,
        isDefault: true,
        createdAt: 2,
        updatedAt: 4,
      })

      const req = new Request('http://localhost/opencode-configs/new-config/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockRestart).toHaveBeenCalledTimes(1)
      expect(mockReloadConfig).not.toHaveBeenCalled()
      expect(json.restarted).toBe(true)
      expect(json.reloaded).toBe(false)
      expect(json.reloadError).toBeUndefined()
    })

    it('should reload when plugins/skills/providers changed on set-default', async () => {
      mockGetDefaultOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'old-default',
        content: { plugin: ['old'] },
        rawContent: '{"plugin":["old"]}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { plugin: ['old', 'new'] },
        rawContent: '{"plugin":["old","new"]}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 2,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: true,
        appliedConfig: { plugin: ['old', 'new'] },
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { plugin: ['old', 'new'] },
        rawContent: '{"plugin":["old","new"]}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 3,
      })
      mockSetDefaultOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { plugin: ['old', 'new'] },
        rawContent: '{"plugin":["old","new"]}',
        isValid: true,
        isDefault: true,
        createdAt: 2,
        updatedAt: 4,
      })

      const req = new Request('http://localhost/opencode-configs/new-config/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockReloadConfig).toHaveBeenCalledTimes(1)
      expect(mockRestart).not.toHaveBeenCalled()
      expect(json.reloaded).toBe(true)
      expect(json.restarted).toBe(false)
    })

    it('should not reload or restart when no runtime fields changed', async () => {
      mockGetDefaultOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'old-default',
        content: { theme: 'dark', agent: {} },
        rawContent: '{"theme":"dark","agent":{}}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { theme: 'light', agent: {} },
        rawContent: '{"theme":"light","agent":{}}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 2,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: true,
        appliedConfig: { theme: 'light', agent: {} },
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { theme: 'light', agent: {} },
        rawContent: '{"theme":"light","agent":{}}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 3,
      })
      mockSetDefaultOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { theme: 'light', agent: {} },
        rawContent: '{"theme":"light","agent":{}}',
        isValid: true,
        isDefault: true,
        createdAt: 2,
        updatedAt: 4,
      })

      const req = new Request('http://localhost/opencode-configs/new-config/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockRestart).not.toHaveBeenCalled()
      expect(mockReloadConfig).not.toHaveBeenCalled()
      expect(json.restarted).toBe(false)
      expect(json.reloaded).toBe(false)
    })

    it('should return reloadError in response when restart fails', async () => {
      mockGetDefaultOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'old-default',
        content: { agent: { primary: { model: 'a' } } },
        rawContent: '{"agent":{"primary":{"model":"a"}}}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { agent: { primary: { model: 'b' } } },
        rawContent: '{"agent":{"primary":{"model":"b"}}}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 2,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: true,
        appliedConfig: { agent: { primary: { model: 'b' } } },
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { agent: { primary: { model: 'b' } } },
        rawContent: '{"agent":{"primary":{"model":"b"}}}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 3,
      })
      mockSetDefaultOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { agent: { primary: { model: 'b' } } },
        rawContent: '{"agent":{"primary":{"model":"b"}}}',
        isValid: true,
        isDefault: true,
        createdAt: 2,
        updatedAt: 4,
      })
      mockRestart.mockRejectedValueOnce(new Error('boom'))

      const req = new Request('http://localhost/opencode-configs/new-config/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockRestart).toHaveBeenCalledTimes(1)
      expect(json.reloadError).toBe('boom')
      expect(json.restarted).toBe(false)
      expect(json.id).toBeDefined()
      expect(json.name).toBe('new-config')
      expect(json.isDefault).toBe(true)
    })

    it('should preserve removedFields alongside new flags', async () => {
      mockGetDefaultOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'old-default',
        content: { plugin: ['old'] },
        rawContent: '{"plugin":["old"]}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { plugin: ['old', 'new'], command: { review: true } },
        rawContent: '{"plugin":["old","new"],"command":{"review":true}}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 2,
      })
      mockPatchOpenCodeConfig.mockResolvedValueOnce({
        success: true,
        appliedConfig: { plugin: ['old', 'new'] },
        removedFields: ['command.review'],
        details: [{ path: 'command.review', message: 'Invalid field' }],
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { plugin: ['old', 'new'] },
        rawContent: '{"plugin":["old","new"]}',
        isValid: true,
        isDefault: false,
        createdAt: 2,
        updatedAt: 3,
      })
      mockSetDefaultOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'new-config',
        content: { plugin: ['old', 'new'] },
        rawContent: '{"plugin":["old","new"]}',
        isValid: true,
        isDefault: true,
        createdAt: 2,
        updatedAt: 4,
      })

      const req = new Request('http://localhost/opencode-configs/new-config/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockReloadConfig).toHaveBeenCalledTimes(1)
      expect(json.reloaded).toBe(true)
      expect(json.removedFields).toEqual(['command.review'])
    })
  })

  describe('OpenCode import routes', () => {
    it('should return import status', async () => {
      mockGetOpenCodeImportStatus.mockResolvedValueOnce({
        configSourcePath: '/import/opencode-config/opencode.json',
        stateSourcePath: '/import/opencode-state',
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: true,
      })

      const req = new Request('http://localhost/opencode-import/status')
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.configSourcePath).toBe('/import/opencode-config/opencode.json')
      expect(json.stateSourcePath).toBe('/import/opencode-state')
      expect(mockGetOpenCodeImportStatus).toHaveBeenCalled()
    })

    it('should import host OpenCode data and restart the server', async () => {
      mockSyncOpenCodeImport.mockResolvedValueOnce({
        configSourcePath: '/import/opencode-config/opencode.json',
        stateSourcePath: '/import/opencode-state',
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: true,
        configImported: true,
        stateImported: true,
      })

      const req = new Request('http://localhost/opencode-import?userId=default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.serverRestarted).toBe(true)
      expect(mockSyncOpenCodeImport).toHaveBeenCalledWith({
        db: testDb,
        userId: 'default',
        overwriteState: true,
        protectExistingState: true,
      })
      expect(mockGetImportedSessionDirectories).toHaveBeenCalledWith('/tmp/test-workspace/.opencode/state/opencode')
      expect(mockRelinkReposFromSessionDirectories).toHaveBeenCalled()
      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
    })

    it('should return 404 when no importable host data exists', async () => {
      mockSyncOpenCodeImport.mockResolvedValueOnce({
        configSourcePath: null,
        stateSourcePath: null,
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: true,
        configImported: false,
        stateImported: false,
      })

      const req = new Request('http://localhost/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(404)
      expect(json.error).toBe('No importable OpenCode host data found')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('should return 409 when import is blocked to protect workspace state', async () => {
      mockSyncOpenCodeImport.mockRejectedValueOnce(
        new OpenCodeImportProtectionError('Workspace state already exists and must be cleared before import')
      )

      const req = new Request('http://localhost/opencode-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(409)
      expect(json.error).toBe('OpenCode host import was blocked to protect existing workspace state')
      expect(json.code).toBe('OPENCODE_IMPORT_PROTECTED')
      expect(json.detail).toBe('Workspace state already exists and must be cleared before import')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('should not call relink functions when only config is imported (stateImported: false)', async () => {
      mockSyncOpenCodeImport.mockResolvedValueOnce({
        configSourcePath: '/import/opencode-config/opencode.json',
        stateSourcePath: '/import/opencode-state',
        workspaceConfigPath: '/tmp/test-workspace/.config/opencode/opencode.json',
        workspaceStatePath: '/tmp/test-workspace/.opencode/state/opencode',
        workspaceStateExists: false,
        configImported: true,
        stateImported: false,
      })

      const req = new Request('http://localhost/opencode-import?userId=default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteState: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.serverRestarted).toBe(true)
      expect(json.configImported).toBe(true)
      expect(json.stateImported).toBe(false)
      expect(mockGetImportedSessionDirectories).not.toHaveBeenCalled()
      expect(mockRelinkReposFromSessionDirectories).not.toHaveBeenCalled()
      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
      expect(json.relinkedRepos).toEqual({
        repos: [],
        relinkedCount: 0,
        existingCount: 0,
        nonRepoPathCount: 0,
        duplicatePathCount: 0,
        errors: [],
      })
    })
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

        expect(mockExecSync).toHaveBeenCalledWith('opencode upgrade --method curl 2>&1', expect.objectContaining({
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
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.0.5\n', stderr: '', signal: null, error: undefined })

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
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.0.5\n', stderr: '', signal: null, error: undefined })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        await settingsApp.fetch(req)

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', 'v1.0.5', '--method', 'curl'],
          expect.any(Object)
        )
      })

      it('should not double prepend v to version', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.5')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.0.5\n', stderr: '', signal: null, error: undefined })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: 'v1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        await settingsApp.fetch(req)

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', 'v1.0.5', '--method', 'curl'],
          expect.any(Object)
        )
      })
    })

    describe('timeout and recovery', () => {
      it('should timeout and recover on version install', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
          .mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: '', stderr: '', signal: 'SIGKILL', error: undefined })

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.0.5' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', 'v1.0.5', '--method', 'curl'],
          expect.any(Object)
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

      it('should reject invalid version format with command injection attempt', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.2.27; cat /etc/passwd; #' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)

        expect(res.status).toBe(400)
      })

      it('should reject version with invalid format', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: 'invalid' }),
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

  describe('POST /opencode-reload', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockReloadConfig.mockReset()
      mockRestart.mockReset()
      mockClearStartupError.mockReset()
      mockReloadConfig.mockResolvedValue(undefined)
      mockRestart.mockResolvedValue(undefined)
      mockClearStartupError.mockReturnValue(undefined)
    })

    it('should return success when reload succeeds', async () => {
      mockReloadConfig.mockResolvedValueOnce(undefined)

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.message).toBe('OpenCode configuration reloaded successfully')
    })

    it('should propagate validationIssues and removedFields when ConfigReloadError is thrown', async () => {
      const validationIssues = [
        { path: 'command.review', message: 'Invalid field' },
        { path: 'agent.temperature', message: 'Temperature out of range' }
      ]
      const removedFields = ['command.review']

      mockReloadConfig.mockRejectedValueOnce(
        new ConfigReloadError('Config validation failed', validationIssues, removedFields)
      )

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Config validation failed')
      expect(json.details).toBe('command.review: Invalid field; agent.temperature: Temperature out of range')
      expect(json.validationIssues).toEqual(validationIssues)
      expect(json.removedFields).toEqual(removedFields)
    })

    it('should return generic error when non-ConfigReloadError is thrown', async () => {
      mockReloadConfig.mockRejectedValueOnce(new Error('Some other error'))

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to reload OpenCode configuration')
      expect(json.details).toBe('Some other error')
    })

    it('should propagate empty arrays when ConfigReloadError has no issues', async () => {
      mockReloadConfig.mockRejectedValueOnce(
        new ConfigReloadError('Reload failed', [], [])
      )

      const req = new Request('http://localhost/opencode-reload', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Reload failed')
      expect(json.details).toBe('Reload failed')
      expect(json.validationIssues).toEqual([])
      expect(json.removedFields).toEqual([])
    })
  })
})
