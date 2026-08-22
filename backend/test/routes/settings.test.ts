import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { Database } from 'bun:sqlite'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'

const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()
const mockResetSettings = vi.fn()
const mockSaveLastKnownGoodConfig = vi.fn()
const mockCreateOpenCodeConfig = vi.fn()
const mockUpdateOpenCodeConfig = vi.fn()
const mockDeleteOpenCodeConfig = vi.fn()
const mockGetOpenCodeConfigByName = vi.fn()
const mockSetDefaultOpenCodeConfig = vi.fn()

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
    resetSettings: mockResetSettings,
    saveLastKnownGoodConfig: mockSaveLastKnownGoodConfig,
    createOpenCodeConfig: mockCreateOpenCodeConfig,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
    deleteOpenCodeConfig: mockDeleteOpenCodeConfig,
    getOpenCodeConfigByName: mockGetOpenCodeConfigByName,
    setDefaultOpenCodeConfig: mockSetDefaultOpenCodeConfig,
  })),
}))

vi.mock('../../src/services/file-operations', () => ({
  writeFileContent: vi.fn(),
  readFileContent: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock('../../src/services/opencode/config-recovery', () => ({
  patchConfigWithRecovery: vi.fn(),
}))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: () => ({
    forward: vi.fn(),
    forwardRaw: vi.fn(),
    getJson: vi.fn(),
    postJson: vi.fn(),
    setProviderAuth: vi.fn(),
    deleteProviderAuth: vi.fn(),
  }),
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
      checkHealth: vi.fn().mockResolvedValue(true),
      markRestartPending: vi.fn(),
      isRestartPending: vi.fn(),
      isSandboxEnforced: vi.fn(),
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

const sandboxRuntimeServiceMock = vi.hoisted(() => ({
  SandboxRuntimeService: vi.fn(),
}))

vi.mock('../../src/services/sandbox/runtime', () => ({
  SandboxRuntimeService: sandboxRuntimeServiceMock.SandboxRuntimeService,
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
    SANDBOX: { START_TIMEOUT_MS: 300000, EXEC_TIMEOUT_MS: 600000 },
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
import { patchConfigWithRecovery } from '../../src/services/opencode/config-recovery'

const mockExecSync = execSync as ReturnType<typeof vi.fn>
const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>
const mockGetVersion = opencodeServerManager.getVersion as ReturnType<typeof vi.fn>
const mockFetchVersion = opencodeServerManager.fetchVersion as ReturnType<typeof vi.fn>
const mockReloadConfig = opencodeServerManager.reloadConfig as ReturnType<typeof vi.fn>
const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>
const mockClearStartupError = opencodeServerManager.clearStartupError as ReturnType<typeof vi.fn>
const mockGetLastStartupError = opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>
const mockIsSandboxEnforced = opencodeServerManager.isSandboxEnforced as ReturnType<typeof vi.fn>
const mockGetOpenCodeImportStatus = getOpenCodeImportStatus as ReturnType<typeof vi.fn>
const mockSyncOpenCodeImport = syncOpenCodeImport as ReturnType<typeof vi.fn>
const mockGetImportedSessionDirectories = getImportedSessionDirectories as ReturnType<typeof vi.fn>
const mockRelinkReposFromSessionDirectories = relinkReposFromSessionDirectories as ReturnType<typeof vi.fn>
const mockWriteFileContent = writeFileContent as ReturnType<typeof vi.fn>
const mockPatchConfigWithRecovery = patchConfigWithRecovery as ReturnType<typeof vi.fn>

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
    mockIsSandboxEnforced.mockReset()
    mockGetSettings.mockReset()
    mockUpdateSettings.mockReset()
    mockResetSettings.mockReset()
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
    mockPatchConfigWithRecovery.mockReset()
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockReset()
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    
    testDb = {} as any
    settingsApp = createSettingsRoutes(testDb, { getGitEnvironment: vi.fn().mockReturnValue({}) } as any, createStubOpenCodeClient())

    mockReloadConfig.mockResolvedValue(undefined)
    mockRestart.mockResolvedValue(undefined)
    mockClearStartupError.mockReturnValue(undefined)
    mockPatchConfigWithRecovery.mockResolvedValue({ success: true, appliedConfig: { $schema: 'https://opencode.ai/config.json' } } as any)
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
      mockPatchConfigWithRecovery.mockResolvedValueOnce({
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
      mockPatchConfigWithRecovery.mockResolvedValueOnce({
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
      mockPatchConfigWithRecovery.mockResolvedValueOnce({
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
      mockPatchConfigWithRecovery.mockResolvedValueOnce({
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

    it('persists recovery-cleaned content back to the DB after a default-config PUT with removedFields (audit regression)', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'cleaned',
        content: {},
        rawContent: '{}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      const firstConfig = {
        id: 2,
        name: 'cleaned',
        content: { command: { review: true }, theme: 'dark' },
        rawContent: '{"command":{"review":true},"theme":"dark"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      }
      const persistedConfig = {
        ...firstConfig,
        content: { theme: 'dark' },
        rawContent: '{\n  "theme": "dark"\n}',
        updatedAt: 3,
      }
      mockUpdateOpenCodeConfig
        .mockReturnValueOnce(firstConfig)
        .mockReturnValueOnce(persistedConfig)
      mockPatchConfigWithRecovery.mockResolvedValueOnce({
        success: true,
        appliedConfig: { theme: 'dark' },
        removedFields: ['command.review'],
      })

      const req = new Request('http://localhost/opencode-configs/cleaned', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '{"command":{"review":true},"theme":"dark"}',
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.removedFields).toEqual(['command.review'])
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(2)
      expect(mockUpdateOpenCodeConfig).toHaveBeenNthCalledWith(
        2,
        'cleaned',
        { content: '{\n  "theme": "dark"\n}' },
        'default',
      )
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/tmp/test-workspace/.config/opencode.json',
        '{\n  "theme": "dark"\n}',
      )
    })

    it('returns 409 instead of 200 when the recovery persistence write reports the config row was removed concurrently (audit regression)', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'cleaned',
        content: {},
        rawContent: '{}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      const firstConfig = {
        id: 2,
        name: 'cleaned',
        content: { command: { review: true }, theme: 'dark' },
        rawContent: '{"command":{"review":true},"theme":"dark"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      }
      mockUpdateOpenCodeConfig
        .mockReturnValueOnce(firstConfig)
        .mockReturnValueOnce(null)
      mockPatchConfigWithRecovery.mockResolvedValueOnce({
        success: true,
        appliedConfig: { theme: 'dark' },
        removedFields: ['command.review'],
      })

      const req = new Request('http://localhost/opencode-configs/cleaned', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '{"command":{"review":true},"theme":"dark"}',
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(409)
      expect(json.error).toBe(
        'OpenCode config was removed while applying recovered fields',
      )
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(2)
      expect(mockUpdateOpenCodeConfig).toHaveBeenNthCalledWith(
        2,
        'cleaned',
        { content: '{\n  "theme": "dark"\n}' },
        'default',
      )
    })

    it('strips configured plugins from a live default-config patch while sandbox enforcement is active', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { plugin: ['evil-plugin'], theme: 'dark' },
        rawContent: '{"plugin":["evil-plugin"],"theme":"dark"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { plugin: ['evil-plugin'], theme: 'light' },
        rawContent: '{"plugin":["evil-plugin"],"theme":"light"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      })
      mockPatchConfigWithRecovery.mockResolvedValue({
        success: true,
        appliedConfig: { theme: 'light' },
      })
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/opencode-configs/enforced', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '{"plugin":["evil-plugin"],"theme":"light"}',
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockPatchConfigWithRecovery).toHaveBeenCalledWith(expect.anything(), { theme: 'light' })
      expect((json.content as Record<string, unknown>).theme).toBe('light')
    })

    it('strips local MCP servers and the formatter from a live default-config patch while sandbox enforcement is active', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: {
          mcp: { local: { type: 'local', command: ['npx', 'evil-server'] }, remote: { type: 'remote', url: 'https://example.com/mcp' } },
          formatter: { typescript: { command: ['prettier'] } },
          theme: 'dark',
        },
        rawContent: JSON.stringify({
          mcp: { local: { type: 'local', command: ['npx', 'evil-server'] }, remote: { type: 'remote', url: 'https://example.com/mcp' } },
          formatter: { typescript: { command: ['prettier'] } },
          theme: 'dark',
        }),
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: {
          mcp: { local: { type: 'local', command: ['npx', 'evil-server'] }, remote: { type: 'remote', url: 'https://example.com/mcp' } },
          formatter: { typescript: { command: ['prettier'] } },
          theme: 'light',
        },
        rawContent: JSON.stringify({
          mcp: { local: { type: 'local', command: ['npx', 'evil-server'] }, remote: { type: 'remote', url: 'https://example.com/mcp' } },
          formatter: { typescript: { command: ['prettier'] } },
          theme: 'light',
        }),
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      })
      mockPatchConfigWithRecovery.mockResolvedValue({
        success: true,
        appliedConfig: { mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } }, theme: 'light' },
      })
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/opencode-configs/enforced', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: JSON.stringify({
            mcp: { local: { type: 'local', command: ['npx', 'evil-server'] }, remote: { type: 'remote', url: 'https://example.com/mcp' } },
            formatter: { typescript: { command: ['prettier'] } },
            theme: 'light',
          }),
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockPatchConfigWithRecovery).toHaveBeenCalledWith(expect.anything(), {
        mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } },
        theme: 'light',
      })
      expect((json.content as Record<string, unknown>).theme).toBe('light')
    })

    it('keeps configured plugins in a live default-config patch when sandbox enforcement is off', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { plugin: ['evil-plugin'], theme: 'dark' },
        rawContent: '{"plugin":["evil-plugin"],"theme":"dark"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { plugin: ['evil-plugin'], theme: 'light' },
        rawContent: '{"plugin":["evil-plugin"],"theme":"light"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      })
      mockPatchConfigWithRecovery.mockResolvedValue({
        success: true,
        appliedConfig: { plugin: ['evil-plugin'], theme: 'light' },
      })
      mockIsSandboxEnforced.mockReturnValue(false)

      const req = new Request('http://localhost/opencode-configs/enforced', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '{"plugin":["evil-plugin"],"theme":"light"}',
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(mockPatchConfigWithRecovery).toHaveBeenCalledWith(
        expect.anything(),
        { plugin: ['evil-plugin'], theme: 'light' },
      )
      expect((json.content as Record<string, unknown>).theme).toBe('light')
    })

    it('writes and persists sanitized content when enforcement strips local MCP and formatter without OpenCode-reported removed fields', async () => {
      const prohibitedContent = {
        mcp: { local: { type: 'local', command: ['npx', 'evil-server'] }, remote: { type: 'remote', url: 'https://example.com/mcp' } },
        formatter: { typescript: { command: ['prettier'] } },
        theme: 'light',
      }
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { ...prohibitedContent, theme: 'dark' },
        rawContent: JSON.stringify({ ...prohibitedContent, theme: 'dark' }),
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig
        .mockReturnValueOnce({
          id: 2,
          name: 'enforced',
          content: prohibitedContent,
          rawContent: JSON.stringify(prohibitedContent),
          isValid: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 2,
        })
        .mockReturnValueOnce({
          id: 2,
          name: 'enforced',
          content: { mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } }, theme: 'light' },
          rawContent: JSON.stringify(
            { mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } }, theme: 'light' },
            null,
            2,
          ),
          isValid: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 3,
        })
      mockPatchConfigWithRecovery.mockResolvedValue({
        success: true,
        appliedConfig: { mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } }, theme: 'light' },
      })
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/opencode-configs/enforced', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: JSON.stringify(prohibitedContent), isDefault: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      const expectedWritten = JSON.stringify(
        { mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } }, theme: 'light' },
        null,
        2,
      )
      expect(res.status).toBe(200)
      expect(mockWriteFileContent).toHaveBeenCalledWith('/tmp/test-workspace/.config/opencode.json', expectedWritten)
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(2)
      expect(mockUpdateOpenCodeConfig).toHaveBeenNthCalledWith(
        2,
        'enforced',
        { content: expectedWritten },
        'default',
      )
      expect(JSON.stringify(json.content)).not.toContain('evil-server')
      expect(JSON.stringify(json.content)).not.toContain('prettier')
    })

    it('writes and persists sanitized content when enforcement strips shell, LSP, hooks, and custom providers', async () => {
      const prohibitedContent = {
        shell: { command: '/repo/.bin/evil-shell', args: [] },
        lsp: true,
        experimental: { hook: { file_edited: [{ command: ['chmod', '+x', 'script.sh'] }] }, chatMaxRetries: 4 },
        provider: { builtin: { options: { apiKey: 'k' } }, evil: { npm: 'file:///repo/evil-provider.js' } },
        theme: 'light',
      }
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { ...prohibitedContent, theme: 'dark' },
        rawContent: JSON.stringify({ ...prohibitedContent, theme: 'dark' }),
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig
        .mockReturnValueOnce({
          id: 2,
          name: 'enforced',
          content: prohibitedContent,
          rawContent: JSON.stringify(prohibitedContent),
          isValid: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 2,
        })
        .mockReturnValueOnce({
          id: 2,
          name: 'enforced',
          content: { experimental: { chatMaxRetries: 4 }, provider: { builtin: { options: { apiKey: 'k' } } }, theme: 'light' },
          rawContent: JSON.stringify(
            { experimental: { chatMaxRetries: 4 }, provider: { builtin: { options: { apiKey: 'k' } } }, theme: 'light' },
            null,
            2,
          ),
          isValid: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 3,
        })
      mockPatchConfigWithRecovery.mockResolvedValue({
        success: true,
        appliedConfig: { experimental: { chatMaxRetries: 4 }, provider: { builtin: { options: { apiKey: 'k' } } }, theme: 'light' },
      })
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/opencode-configs/enforced', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: JSON.stringify(prohibitedContent), isDefault: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      const expectedWritten = JSON.stringify(
        { experimental: { chatMaxRetries: 4 }, provider: { builtin: { options: { apiKey: 'k' } } }, theme: 'light' },
        null,
        2,
      )
      expect(res.status).toBe(200)
      expect(mockWriteFileContent).toHaveBeenCalledWith('/tmp/test-workspace/.config/opencode.json', expectedWritten)
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(json.content)).not.toContain('evil-shell')
      expect(JSON.stringify(json.content)).not.toContain('chmod')
      expect(JSON.stringify(json.content)).not.toContain('evil-provider')
    })

    it('keeps the original raw content when enforcement strips nothing', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { mcp: { local: { type: 'local', command: ['npx', 'evil-server'] } }, theme: 'dark' },
        rawContent: '{"mcp":{"local":{"type":"local","command":["npx","evil-server"]}},"theme":"dark"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { mcp: { local: { type: 'local', command: ['npx', 'evil-server'] } }, theme: 'light' },
        rawContent: '{"mcp":{"local":{"type":"local","command":["npx","evil-server"]}},"theme":"light"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      })
      mockPatchConfigWithRecovery.mockResolvedValue({
        success: true,
        appliedConfig: { mcp: { local: { type: 'local', command: ['npx', 'evil-server'] } }, theme: 'light' },
      })
      mockIsSandboxEnforced.mockReturnValue(false)

      const req = new Request('http://localhost/opencode-configs/enforced', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '{"mcp":{"local":{"type":"local","command":["npx","evil-server"]}},"theme":"light"}',
          isDefault: true,
        }),
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/tmp/test-workspace/.config/opencode.json',
        '{"mcp":{"local":{"type":"local","command":["npx","evil-server"]}},"theme":"light"}',
      )
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(1)
    })

    it('writes and persists sanitized content on a restart-required PUT while enforcement is active', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { theme: 'dark' },
        rawContent: '{"theme":"dark"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { plugin: ['evil-plugin'], theme: 'light' },
        rawContent: '{"plugin":["evil-plugin"],"theme":"light"}',
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      })
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/opencode-configs/enforced', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"plugin":["evil-plugin"],"theme":"light"}', isDefault: true }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBe(true)
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/tmp/test-workspace/.config/opencode.json',
        JSON.stringify({ theme: 'light' }, null, 2),
      )
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledTimes(2)
      expect(mockUpdateOpenCodeConfig).toHaveBeenNthCalledWith(
        2,
        'enforced',
        { content: JSON.stringify({ theme: 'light' }, null, 2) },
        'default',
      )
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalled()
    })

    it('writes sanitized content when creating a plugin-bearing default config while enforcement is active', async () => {
      mockCreateOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'enforced',
        content: { plugin: ['evil-plugin'], theme: 'dark' },
        rawContent: '{"plugin":["evil-plugin"],"theme":"dark"}',
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 1,
        name: 'enforced',
        content: { theme: 'dark' },
        rawContent: JSON.stringify({ theme: 'dark' }, null, 2),
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      })
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/opencode-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'enforced', content: '{"plugin":["evil-plugin"],"theme":"dark"}', isDefault: true }),
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledWith(
        'enforced',
        { content: JSON.stringify({ theme: 'dark' }, null, 2), isDefault: true },
        'default',
      )
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/tmp/test-workspace/.config/opencode.json',
        JSON.stringify({ theme: 'dark' }, null, 2),
      )
    })

    it('writes sanitized content when setting a plugin-bearing config as default while enforcement is active', async () => {
      mockGetOpenCodeConfigByName.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { plugin: ['evil-plugin'], theme: 'dark' },
        rawContent: '{"plugin":["evil-plugin"],"theme":"dark"}',
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      })
      mockUpdateOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { theme: 'dark' },
        rawContent: JSON.stringify({ theme: 'dark' }, null, 2),
        isValid: true,
        isDefault: false,
        createdAt: 1,
        updatedAt: 2,
      })
      mockSetDefaultOpenCodeConfig.mockReturnValue({
        id: 2,
        name: 'enforced',
        content: { theme: 'dark' },
        rawContent: JSON.stringify({ theme: 'dark' }, null, 2),
        isValid: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 3,
      })
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/opencode-configs/enforced/set-default', {
        method: 'POST',
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(mockUpdateOpenCodeConfig).toHaveBeenCalledWith(
        'enforced',
        { content: JSON.stringify({ theme: 'dark' }, null, 2) },
        'default',
      )
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/tmp/test-workspace/.config/opencode.json',
        JSON.stringify({ theme: 'dark' }, null, 2),
      )
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
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
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
        expect(json.message).toBe('OpenCode upgraded from v1.0.0 to v1.0.1 and restarted')
      })

      it('should use a freshly fetched version and restart when the cached version is stale after upgrade', async () => {
        mockGetVersion.mockReturnValue('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.upgraded).toBe(true)
        expect(json.newVersion).toBe('1.0.1')
        expect(mockFetchVersion).toHaveBeenCalledTimes(1)
        expect(mockRestart).toHaveBeenCalledTimes(1)
        expect(mockReloadConfig).not.toHaveBeenCalled()
      })

      it('should return already up to date when version unchanged', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.0')
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
        expect(mockFetchVersion).toHaveBeenCalledTimes(1)
      })

      it('should restart directly after a successful upgrade', async () => {
        mockGetVersion.mockReturnValueOnce('1.0.0')
        mockFetchVersion.mockResolvedValueOnce('1.0.1')
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        await settingsApp.fetch(req)

        expect(mockRestart).toHaveBeenCalledTimes(1)
        expect(mockReloadConfig).not.toHaveBeenCalled()
      })

      it('allows upgrading while sandbox enforcement is active', async () => {
        mockIsSandboxEnforced.mockReturnValue(true)
        mockGetVersion.mockReturnValueOnce('1.18.16')
        mockFetchVersion.mockResolvedValueOnce('1.19.0')
        mockExecSync.mockReturnValueOnce('Upgrade successful\n')

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-upgrade', { method: 'POST' }))

        expect(res.status).toBe(200)
        expect(mockExecSync).toHaveBeenCalled()
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

      it('allows installing any version while sandbox enforcement is active', async () => {
        mockIsSandboxEnforced.mockReturnValue(true)
        mockGetVersion.mockReturnValueOnce('1.18.16')
        mockFetchVersion.mockResolvedValueOnce('1.20.0')
        mockSpawnSync.mockReturnValueOnce({ stdout: 'Installed v1.20.0\n', stderr: '', signal: null, error: undefined })

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.20.0' }),
          headers: { 'Content-Type': 'application/json' }
        }))

        expect(res.status).toBe(200)
        expect(mockSpawnSync).toHaveBeenCalledWith(
          'opencode',
          ['upgrade', 'v1.20.0', '--method', 'curl'],
          expect.any(Object)
        )
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
        .mockReturnValueOnce('1.0.0')
      mockFetchVersion.mockRejectedValueOnce(new Error('Fetch version failed'))
      mockExecSync.mockReturnValueOnce('Upgrade successful\n')

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.recovered).toBe(true)
      expect(mockRestart).toHaveBeenCalledTimes(1)
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

    it('returns 500 with the startup failure reason when a supervisor reload is unhealthy', async () => {
      mockGetLastStartupError.mockReturnValue('OpenCode config reload failed after recovery')
      const unhealthySupervisor = {
        restart: vi.fn(),
        reloadConfig: vi.fn().mockResolvedValue({ healthy: false }),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        unhealthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-reload', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.success).toBeUndefined()
      expect(json.error).toBe('Failed to reload OpenCode configuration')
      expect(json.details).toBe('OpenCode config reload failed after recovery')
      expect(unhealthySupervisor.reloadConfig).toHaveBeenCalledWith('settings_reload')
    })

    it('returns success when a supervisor reload is healthy', async () => {
      const healthySupervisor = {
        restart: vi.fn(),
        reloadConfig: vi.fn().mockResolvedValue({ healthy: true }),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        healthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-reload', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(healthySupervisor.reloadConfig).toHaveBeenCalledWith('settings_reload')
    })
  })

  describe('POST /opencode-restart', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockRestart.mockReset()
      mockClearStartupError.mockReset()
      mockGetLastStartupError.mockReset()
      mockRestart.mockResolvedValue(undefined)
      mockClearStartupError.mockReturnValue(undefined)
    })

    it('returns 500 with the startup failure reason when a supervisor restart is unhealthy', async () => {
      mockGetLastStartupError.mockReturnValue('OpenCode version 1.18.15 does not support sandboxed bash tool rewriting')
      const unhealthySupervisor = {
        restart: vi.fn().mockResolvedValue({ healthy: false }),
        reloadConfig: vi.fn(),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        unhealthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-restart', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.success).toBeUndefined()
      expect(json.error).toBe('Failed to restart OpenCode server')
      expect(json.details).toContain('does not support sandboxed bash tool rewriting')
      expect(unhealthySupervisor.restart).toHaveBeenCalledWith('settings_restart')
    })

    it('returns success when a supervisor restart is healthy', async () => {
      const healthySupervisor = {
        restart: vi.fn().mockResolvedValue({ healthy: true }),
        reloadConfig: vi.fn(),
      }
      const app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        healthySupervisor as any,
      )

      const req = new Request('http://localhost/opencode-restart', { method: 'POST' })
      const res = await app.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.message).toBe('OpenCode server restarted successfully')
      expect(json.resumedSessions).toEqual([])
    })

    it('returns 500 when a manager restart fails without a supervisor', async () => {
      mockRestart.mockRejectedValue(new Error('server failed to become healthy'))
      mockGetLastStartupError.mockReturnValue('server failed to become healthy')

      const req = new Request('http://localhost/opencode-restart', { method: 'POST' })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to restart OpenCode server')
      expect(json.details).toBe('server failed to become healthy')
    })
  })

  describe('PATCH / - sandbox preference restart pending', () => {
    it('marks the OpenCode server restart pending when sandbox.enabled changes', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: false } },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true } },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true } } }),
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('does not mark the OpenCode server restart pending when sandbox is unchanged', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true } },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true } },
        updatedAt: 1,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true } } }),
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('does not mark the OpenCode server restart pending when sandbox is absent from the patch', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true } },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true } },
        updatedAt: 1,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { theme: 'dark' } }),
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })
  })

  describe('DELETE / - sandbox preference restart pending', () => {
    it('marks the OpenCode server restart pending when resetting disables sandboxing', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true } },
        updatedAt: 1,
      })
      mockResetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: false } },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', { method: 'DELETE' })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('does not mark the OpenCode server restart pending when resetting an already-default sandbox preference', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: false } },
        updatedAt: 1,
      })
      mockResetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: false } },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', { method: 'DELETE' })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })
  })

  describe('Settings Routes - manager token rotation', () => {
    let settingsApp: ReturnType<typeof createSettingsRoutes>
    let tokenDb: Database

    beforeEach(() => {
      vi.clearAllMocks()
      tokenDb = new Database(':memory:')
      migrate(tokenDb, allMigrations)
      settingsApp = createSettingsRoutes(
        tokenDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
      )
      mockRestart.mockResolvedValue(undefined)
      mockClearStartupError.mockReturnValue(undefined)
    })

    afterEach(() => {
      tokenDb.close()
    })

    it('rotates the manager token and marks the OpenCode server restart as pending', async () => {
      const previous = getOrCreateInternalToken(tokenDb)

      const res = await settingsApp.fetch(new Request('http://localhost/manager-token/rotate', { method: 'POST' }))
      const json = await res.json() as { token: string }

      expect(res.status).toBe(200)
      expect(json.token).toBeDefined()
      expect(json.token).not.toBe(previous)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('does not mark the OpenCode server restart as pending when rotation fails', async () => {
      const brokenDb = {
        prepare: vi.fn(() => {
          throw new Error('database is unavailable')
        }),
      } as any
      settingsApp = createSettingsRoutes(
        brokenDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
      )

      const res = await settingsApp.fetch(new Request('http://localhost/manager-token/rotate', { method: 'POST' }))

      expect(res.status).toBe(500)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })
  })
})
