import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { Database } from 'bun:sqlite'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'

const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()
const mockResetSettings = vi.fn()
const mockGetLastKnownGoodConfig = vi.fn()
const {
  mockReadOpenCodeConfigFile,
  mockDeleteOpenCodeConfigFile,
  mockArchiveBrokenOpenCodeConfigFile,
  mockRestoreOpenCodeConfigSnapshot,
  mockApplyOpenCodeConfigUpdate,
} = vi.hoisted(() => ({
  mockReadOpenCodeConfigFile: vi.fn(),
  mockDeleteOpenCodeConfigFile: vi.fn(),
  mockArchiveBrokenOpenCodeConfigFile: vi.fn(),
  mockRestoreOpenCodeConfigSnapshot: vi.fn(),
  mockApplyOpenCodeConfigUpdate: vi.fn(),
}))

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

const {
  mockGetOpenCodeServerPasswordSource,
  mockGetStoredOpenCodeServerPasswordState,
  mockClearOpenCodeServerPassword,
  mockSetOpenCodeServerPassword,
  mockRestoreOpenCodeServerPasswordState,
} = vi.hoisted(() => ({
  mockGetOpenCodeServerPasswordSource: vi.fn(),
  mockGetStoredOpenCodeServerPasswordState: vi.fn(),
  mockClearOpenCodeServerPassword: vi.fn(),
  mockSetOpenCodeServerPassword: vi.fn(),
  mockRestoreOpenCodeServerPasswordState: vi.fn(),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
    resetSettings: mockResetSettings,
    getLastKnownGoodConfig: mockGetLastKnownGoodConfig,
    getOpenCodeServerPasswordSource: mockGetOpenCodeServerPasswordSource,
    getStoredOpenCodeServerPasswordState: mockGetStoredOpenCodeServerPasswordState,
    clearOpenCodeServerPassword: mockClearOpenCodeServerPassword,
    setOpenCodeServerPassword: mockSetOpenCodeServerPassword,
    restoreOpenCodeServerPasswordState: mockRestoreOpenCodeServerPasswordState,
  })),
}))

const {
  mockListManagedSkills,
  mockGetSkill,
  mockCreateSkill,
  mockUpdateSkill,
  mockDeleteSkill,
  mockInstallSkillFromGithubTree,
  mockInstallSkillFromUploadedFiles,
} = vi.hoisted(() => ({
  mockListManagedSkills: vi.fn(),
  mockGetSkill: vi.fn(),
  mockCreateSkill: vi.fn(),
  mockUpdateSkill: vi.fn(),
  mockDeleteSkill: vi.fn(),
  mockInstallSkillFromGithubTree: vi.fn(),
  mockInstallSkillFromUploadedFiles: vi.fn(),
}))

vi.mock('../../src/services/skills', () => ({
  listManagedSkills: mockListManagedSkills,
  getSkill: mockGetSkill,
  createSkill: mockCreateSkill,
  updateSkill: mockUpdateSkill,
  deleteSkill: mockDeleteSkill,
  installSkillFromGithubTree: mockInstallSkillFromGithubTree,
  installSkillFromUploadedFiles: mockInstallSkillFromUploadedFiles,
}))

const {
  mockInstallOpenCodeDirectoryFiles,
  mockListOpenCodeDirectoryFiles,
  mockGetOpenCodeDirectoryFile,
  mockUpdateOpenCodeDirectoryFile,
  mockDeleteOpenCodeDirectoryFile,
} = vi.hoisted(() => ({
  mockInstallOpenCodeDirectoryFiles: vi.fn(),
  mockListOpenCodeDirectoryFiles: vi.fn(),
  mockGetOpenCodeDirectoryFile: vi.fn(),
  mockUpdateOpenCodeDirectoryFile: vi.fn(),
  mockDeleteOpenCodeDirectoryFile: vi.fn(),
}))

vi.mock('../../src/services/opencode-directory-files', () => ({
  installOpenCodeDirectoryFiles: mockInstallOpenCodeDirectoryFiles,
  listOpenCodeDirectoryFiles: mockListOpenCodeDirectoryFiles,
  getOpenCodeDirectoryFile: mockGetOpenCodeDirectoryFile,
  updateOpenCodeDirectoryFile: mockUpdateOpenCodeDirectoryFile,
  deleteOpenCodeDirectoryFile: mockDeleteOpenCodeDirectoryFile,
}))

const { mockDiscoverModelsCached } = vi.hoisted(() => ({
  mockDiscoverModelsCached: vi.fn(),
}))

vi.mock('../../src/utils/discovery-cache', () => ({
  discoverModelsCached: mockDiscoverModelsCached,
}))

const { mockValidateSSHPrivateKey } = vi.hoisted(() => ({
  mockValidateSSHPrivateKey: vi.fn(),
}))

vi.mock('../../src/utils/ssh-validation', () => ({
  validateSSHPrivateKey: mockValidateSSHPrivateKey,
}))

vi.mock('../../src/services/file-operations', () => ({
  writeFileContent: vi.fn(),
  readFileContent: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock('../../src/services/opencode-config-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-config-file')>()
  return {
    ...actual,
    readOpenCodeConfigFile: mockReadOpenCodeConfigFile,
    deleteOpenCodeConfigFile: mockDeleteOpenCodeConfigFile,
    archiveBrokenOpenCodeConfigFile: mockArchiveBrokenOpenCodeConfigFile,
    restoreOpenCodeConfigSnapshot: mockRestoreOpenCodeConfigSnapshot,
    withOpenCodeConfigLock: (fn: () => Promise<unknown>) => fn(),
  }
})

vi.mock('../../src/services/opencode-config-apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-config-apply')>()
  return {
    ...actual,
    applyOpenCodeConfigUpdate: mockApplyOpenCodeConfigUpdate,
  }
})

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: () => ({
    forwardRaw: vi.fn(),
  }),
}))

vi.mock('../../src/services/opencode-single-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-single-server')>()
  
  class MockConfigReloadError extends Error {
    validationIssues: Array<{ path: string; message: string }>

    constructor(message: string, validationIssues: Array<{ path: string; message: string }> = []) {
      super(message)
      this.name = 'ConfigReloadError'
      this.validationIssues = validationIssues
    }
  }

  return {
    ...actual,
    opencodeServerManager: {
      getVersion: vi.fn(),
      fetchVersion: vi.fn(),
      restart: vi.fn(),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(),
      checkHealth: vi.fn().mockResolvedValue(true),
      markRestartPending: vi.fn(),
      isRestartPending: vi.fn(),
      isSandboxEnforced: vi.fn(),
      setDatabase: vi.fn(),
    },
    ConfigReloadError: MockConfigReloadError,
  }
})

const openCodeInstallerMock = vi.hoisted(() => ({
  installOpenCodeVersion: vi.fn(),
  latestOpenCodeVersion: vi.fn(),
}))

vi.mock('../../src/services/opencode-installer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-installer')>()
  return {
    ...actual,
    installOpenCodeVersion: openCodeInstallerMock.installOpenCodeVersion,
    latestOpenCodeVersion: openCodeInstallerMock.latestOpenCodeVersion,
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

const capabilityMock = vi.hoisted(() => ({
  detectSandboxCapability: vi.fn(),
}))

vi.mock('../../src/services/sandbox/capability', () => ({
  detectSandboxCapability: capabilityMock.detectSandboxCapability,
  resetSandboxCapabilityCache: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace'),
  getReposPath: vi.fn(() => '/tmp/test-repos'),
  getOpenCodeConfigFilePath: vi.fn(() => '/tmp/test-workspace/.config/opencode.json'),
  getOpenCodeHealthWatchPath: vi.fn(() => '/tmp/test-workspace/health-watch'),
  getAgentsMdPath: vi.fn(() => '/tmp/test-workspace/AGENTS.md'),
  getDatabasePath: vi.fn(() => ':memory:'),
  getConfigPath: vi.fn(() => '/tmp/test-workspace/config'),
  OPENCODE_CONFIG_SOURCE_NAMES: ['opencode.json', 'opencode.jsonc'],
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: { TRUSTED_ORIGINS: 'http://localhost:5173', SECRET: 'test-secret-for-encryption-key-32c' },
    WORKSPACE: { BASE_PATH: '/tmp/test-workspace', REPOS_DIR: 'repos', CONFIG_DIR: 'config' },
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
import { clearOpenCodeVersionCache } from '../../src/services/opencode-installer'
import { getImportedSessionDirectories, getOpenCodeImportStatus, OpenCodeImportProtectionError, syncOpenCodeImport } from '../../src/services/opencode-import'
import { relinkReposFromSessionDirectories } from '../../src/services/repo'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { detectSandboxCapability } from '../../src/services/sandbox/capability'
import { forceProcessAttestation } from '../../src/services/opencode/process-identity'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { createRepo } from '../../src/db/queries'
import type { OpenCodeClient } from '../../src/services/opencode/client'

const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>
const mockGetVersion = opencodeServerManager.getVersion as ReturnType<typeof vi.fn>
const mockFetchVersion = opencodeServerManager.fetchVersion as ReturnType<typeof vi.fn>
const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>
const mockClearStartupError = opencodeServerManager.clearStartupError as ReturnType<typeof vi.fn>
const mockGetLastStartupError = opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>
const mockIsSandboxEnforced = opencodeServerManager.isSandboxEnforced as ReturnType<typeof vi.fn>
const mockGetOpenCodeImportStatus = getOpenCodeImportStatus as ReturnType<typeof vi.fn>
const mockSyncOpenCodeImport = syncOpenCodeImport as ReturnType<typeof vi.fn>
const mockGetImportedSessionDirectories = getImportedSessionDirectories as ReturnType<typeof vi.fn>
const mockRelinkReposFromSessionDirectories = relinkReposFromSessionDirectories as ReturnType<typeof vi.fn>
const mockDetectSandboxCapability = detectSandboxCapability as ReturnType<typeof vi.fn>
const mockInstallOpenCodeVersion = openCodeInstallerMock.installOpenCodeVersion
const mockLatestOpenCodeVersion = openCodeInstallerMock.latestOpenCodeVersion

describe('Settings Routes - OpenCode Upgrade', () => {
  let settingsApp: ReturnType<typeof createSettingsRoutes>
  let testDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVersion.mockReset()
    mockFetchVersion.mockReset()
    mockRestart.mockReset()
    mockClearStartupError.mockReset()
    mockIsSandboxEnforced.mockReset()
    mockGetSettings.mockReset()
    mockUpdateSettings.mockReset()
    mockResetSettings.mockReset()
    mockGetLastKnownGoodConfig.mockReset()
    mockGetOpenCodeImportStatus.mockReset()
    mockSyncOpenCodeImport.mockReset()
    mockGetImportedSessionDirectories.mockReset()
    mockRelinkReposFromSessionDirectories.mockReset()
    mockReadOpenCodeConfigFile.mockReset()
    mockDeleteOpenCodeConfigFile.mockReset()
    mockArchiveBrokenOpenCodeConfigFile.mockReset()
    mockRestoreOpenCodeConfigSnapshot.mockReset()
    mockApplyOpenCodeConfigUpdate.mockReset()
    mockDetectSandboxCapability.mockReset()
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 1.0.0' })
    mockInstallOpenCodeVersion.mockReset()
    mockInstallOpenCodeVersion.mockResolvedValue('/home/node/.opencode/bin/opencode')
    mockLatestOpenCodeVersion.mockReset()
    mockLatestOpenCodeVersion.mockResolvedValue('2.0.15')
    forceProcessAttestation(true)
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockReset()
    sandboxRuntimeServiceMock.SandboxRuntimeService.mockImplementation(() => ({
      isEnabled: () => false,
    }))
    
    testDb = {} as any
    settingsApp = createSettingsRoutes(testDb, { getGitEnvironment: vi.fn().mockReturnValue({}) } as any, createStubOpenCodeClient())

    mockRestart.mockResolvedValue(undefined)
    mockClearStartupError.mockReturnValue(undefined)
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
    it('returns the on-disk config state from GET /opencode-config', async () => {
      const fileState = {
        path: '/tmp/test-workspace/.config/opencode.json',
        content: { theme: 'dark' },
        rawContent: '{"theme":"dark"}',
        isValid: true,
        updatedAt: 1,
      }
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(fileState)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config'))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual(fileState)
    })

    it('returns 404 from GET /opencode-config when no config file exists', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(null)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config'))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(404)
      expect(json.error).toBe('No OpenCode config file found')
    })

    it('maps a restart-pending apply result to 200 with restartRequired', async () => {
      const config = {
        path: '/tmp/test-workspace/.config/opencode.json',
        content: { plugin: ['evil-plugin'] },
        rawContent: '{"plugin":["evil-plugin"]}',
        isValid: true,
        updatedAt: 2,
      }
      mockApplyOpenCodeConfigUpdate.mockResolvedValueOnce({ status: 'restart_pending', config })

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"plugin":["evil-plugin"]}' }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual({ ...config, restartRequired: true })
      expect(mockApplyOpenCodeConfigUpdate).toHaveBeenCalledWith({
        content: '{"plugin":["evil-plugin"]}',
        source: undefined,
        expectedRevision: undefined,
        settingsService: expect.anything(),
        openCodeClient: expect.anything(),
      })
    })

    it('maps an unchanged applied result to 200 without requesting a restart', async () => {
      const config = {
        path: '/tmp/test-workspace/.config/opencode.json',
        content: { theme: 'light' },
        rawContent: '{"theme":"light"}',
        isValid: true,
        updatedAt: 3,
      }
      mockApplyOpenCodeConfigUpdate.mockResolvedValueOnce({ status: 'applied', config })

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { theme: 'light' } }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual(config)
      expect(mockApplyOpenCodeConfigUpdate).toHaveBeenCalledWith({
        content: { theme: 'light' },
        source: undefined,
        expectedRevision: undefined,
        settingsService: expect.anything(),
        openCodeClient: expect.anything(),
      })
    })

    it('returns 400 when the PUT body fails schema validation', async () => {
      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 123 }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Invalid config data')
      expect(mockApplyOpenCodeConfigUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when the PUT body is malformed JSON', async () => {
      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Invalid JSON')
      expect(mockApplyOpenCodeConfigUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 when the PUT body is empty', async () => {
      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.error).toBe('Invalid JSON')
      expect(mockApplyOpenCodeConfigUpdate).not.toHaveBeenCalled()
    })

    it('returns 500 when applying the config fails', async () => {
      mockApplyOpenCodeConfigUpdate.mockRejectedValueOnce(new Error('write failed'))

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"theme":"light"}' }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to update OpenCode config')
    })

    it('writes the last known good config and restarts on rollback', async () => {
      mockGetLastKnownGoodConfig.mockReturnValueOnce('{"theme":"dark"}')
      mockRestoreOpenCodeConfigSnapshot.mockResolvedValueOnce({
        path: '/tmp/test-workspace/.config/opencode.json',
        rawContent: '{"theme":"dark"}',
        content: { theme: 'dark' },
        isValid: true,
        updatedAt: 1,
      })
      mockReadOpenCodeConfigFile.mockResolvedValueOnce({
        path: '/tmp/test-workspace/.config/opencode.json',
        rawContent: '{"theme":"dark"}',
        content: { theme: 'dark' },
        isValid: true,
        updatedAt: 1,
      })

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-rollback', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual({ success: true, message: 'Server restarted with the previous working config' })
      expect(mockRestoreOpenCodeConfigSnapshot).toHaveBeenCalledWith('{"theme":"dark"}')
      expect(mockClearStartupError).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
    })

    it('returns 404 from rollback when no last known good config exists', async () => {
      mockGetLastKnownGoodConfig.mockReturnValueOnce(null)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-rollback', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(404)
      expect(json.error).toBe('No previous working config available for rollback')
      expect(mockRestoreOpenCodeConfigSnapshot).not.toHaveBeenCalled()
    })

    it('deletes the config file and restarts when the rollback reload fails', async () => {
      mockGetLastKnownGoodConfig.mockReturnValueOnce('{"theme":"dark"}')
      mockRestoreOpenCodeConfigSnapshot.mockResolvedValueOnce({
        path: '/tmp/test-workspace/.config/opencode.json',
        rawContent: '{"theme":"dark"}',
        content: { theme: 'dark' },
        isValid: true,
        updatedAt: 1,
      })
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(null)
      mockDeleteOpenCodeConfigFile.mockResolvedValueOnce(true)

      const res = await settingsApp.fetch(new Request('http://localhost/opencode-rollback', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual({
        success: true,
        message: 'Server restarted after deleting the broken config file. The previous working config remains available for rollback.',
        fallback: true,
      })
      expect(mockRestoreOpenCodeConfigSnapshot).toHaveBeenCalledWith('{"theme":"dark"}')
      expect(mockArchiveBrokenOpenCodeConfigFile).toHaveBeenCalled()
      expect(mockDeleteOpenCodeConfigFile).toHaveBeenCalled()
      expect(mockRestart).toHaveBeenCalled()
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
        overwriteState: true,
        protectExistingState: true,
        settingsService: expect.anything(),
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
      it('should install the latest version and respond with success', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.upgraded).toBe(true)
        expect(json.oldVersion).toBe('2.0.14')
        expect(json.newVersion).toBe('2.0.15')
        expect(json.message).toBe('OpenCode upgraded from v2.0.14 to v2.0.15 and restarted')
        expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.0.15')
      })

      it('should not install when the latest version is not newer', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.15')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.upgraded).toBe(false)
        expect(json.message).toContain('already up to date')
        expect(mockInstallOpenCodeVersion).not.toHaveBeenCalled()
        expect(mockRestart).not.toHaveBeenCalled()
      })

      it('should replace an unsupported newer major with the latest supported release', async () => {
        mockGetVersion.mockReturnValueOnce('3.0.0')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-upgrade', { method: 'POST' }))
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.upgraded).toBe(true)
        expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.0.15')
      })

      it('should restart directly after a successful upgrade', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        await settingsApp.fetch(req)

        expect(mockRestart).toHaveBeenCalledTimes(1)
      })

      it('allows upgrading while sandbox enforcement is active', async () => {
        mockIsSandboxEnforced.mockReturnValue(true)
        mockGetVersion.mockReturnValueOnce('2.0.14')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-upgrade', { method: 'POST' }))

        expect(res.status).toBe(200)
        expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.0.15')
        expect(mockRestart).toHaveBeenCalled()
      })
    })

    describe('failure and recovery scenarios', () => {
      it('should attempt server recovery when the install fails', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
          .mockReturnValueOnce('2.0.14')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockRejectedValueOnce(new Error('download failed'))

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(mockClearStartupError).toHaveBeenCalled()
        expect(mockRestart).toHaveBeenCalled()
        expect(res.status).toBe(400)
        expect(json).toMatchObject({
          upgraded: false,
          recovered: true,
          oldVersion: '2.0.14',
          newVersion: '2.0.14'
        })
        expect(json.error).toContain('recovered')
      })

      it('should return 500 when recovery fails', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
          .mockReturnValueOnce('2.0.14')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockRejectedValueOnce(new Error('download failed'))
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
      it('should install and restart when getVersion returns null', async () => {
        mockGetVersion.mockReturnValueOnce(null)
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.upgraded).toBe(true)
        expect(json.oldVersion).toBe(null)
        expect(json.newVersion).toBe('2.0.15')
        expect(json.message).toBe('OpenCode v2.0.15 installed and restarted')
        expect(mockFetchVersion).toHaveBeenCalled()
        expect(mockClearStartupError).toHaveBeenCalled()
        expect(mockRestart).toHaveBeenCalledTimes(1)
      })

      it('should fail recovery when the installed version cannot be detected', async () => {
        mockGetVersion.mockReturnValueOnce(null)
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockFetchVersion.mockResolvedValueOnce(null)
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const req = new Request('http://localhost/opencode-upgrade', {
          method: 'POST'
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(400)
        expect(json.success).toBe(false)
        expect(json.upgraded).toBe(false)
        expect(json.recovered).toBe(true)
        expect(json.error).toBe('Upgrade failed but server recovered')
        expect(json.details).toContain('did not result in version 2.0.15')
        expect(mockRestart).toHaveBeenCalledTimes(1)
      })

      it('should not report success when an override still resolves to the older version', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
        mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
        mockFetchVersion.mockResolvedValueOnce('2.0.14')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-upgrade', { method: 'POST' }))
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(400)
        expect(json.success).toBe(false)
        expect(json.upgraded).toBe(false)
        expect(json.recovered).toBe(true)
        expect(json.error).toBe('Upgrade failed but server recovered')
        expect(json.details).toContain('did not result in version 2.0.15')
        expect(mockRestart).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('POST /opencode-install-version', () => {
    describe('successful installation', () => {
      it('should install specific version successfully', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '2.0.15' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.newVersion).toBe('2.0.15')
        expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.0.15')
      })

      it('does not report success when the requested version was not installed', async () => {
        mockGetVersion.mockReturnValue('2.0.14')
        mockFetchVersion.mockResolvedValueOnce('2.0.14')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '2.0.15' }),
          headers: { 'Content-Type': 'application/json' }
        }))
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(400)
        expect(json.success).toBe(false)
        expect(json.details).toContain('did not result in version 2.0.15')
        expect(json.newVersion).toBe('2.0.14')
      })

      it('allows installing any version while sandbox enforcement is active', async () => {
        mockIsSandboxEnforced.mockReturnValue(true)
        mockGetVersion.mockReturnValueOnce('2.0.14')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const res = await settingsApp.fetch(new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '2.0.15' }),
          headers: { 'Content-Type': 'application/json' }
        }))

        expect(res.status).toBe(200)
        expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.0.15')
      })

      it('should install the bare version when the request carries a v prefix', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
        mockFetchVersion.mockResolvedValueOnce('2.0.15')
        mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: 'v2.0.15' }),
          headers: { 'Content-Type': 'application/json' }
        })
        await settingsApp.fetch(req)

        expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.0.15')
      })
    })

    describe('failure and recovery', () => {
      it('should recover the server when the version install fails', async () => {
        mockGetVersion.mockReturnValueOnce('2.0.14')
          .mockReturnValueOnce('2.0.14')
        mockFetchVersion.mockResolvedValueOnce('2.0.14')
        mockInstallOpenCodeVersion.mockRejectedValueOnce(new Error('download failed'))

        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '2.0.15' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

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

      it('should reject an OpenCode 1.x version before installing anything', async () => {
        const req = new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '1.18.32' }),
          headers: { 'Content-Type': 'application/json' }
        })
        const res = await settingsApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(400)
        expect(json.error).toBe('OpenCode 1.18.32 is not supported; OpenCode Manager requires OpenCode >=2.0.15 <3.0.0')
        expect(mockInstallOpenCodeVersion).not.toHaveBeenCalled()
      })

      it.each(['2.0.14', '3.0.0'])('should reject %s outside the supported range before installing anything', async (version) => {
        const res = await settingsApp.fetch(new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version }),
          headers: { 'Content-Type': 'application/json' }
        }))
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(400)
        expect(json.error).toBe(`OpenCode ${version} is not supported; OpenCode Manager requires OpenCode >=2.0.15 <3.0.0`)
        expect(mockInstallOpenCodeVersion).not.toHaveBeenCalled()
      })

      it('should reject a prerelease version before installing anything', async () => {
        const res = await settingsApp.fetch(new Request('http://localhost/opencode-install-version', {
          method: 'POST',
          body: JSON.stringify({ version: '2.1.0-beta.1' }),
          headers: { 'Content-Type': 'application/json' }
        }))

        expect(res.status).toBe(400)
        expect(mockInstallOpenCodeVersion).not.toHaveBeenCalled()
      })
    })
  })

  describe('error scenarios - server stability', () => {
    it('should not crash when the install throws an unexpected error', async () => {
      mockGetVersion.mockReturnValueOnce('2.0.14')
          .mockReturnValue('2.0.14')
      mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
      mockInstallOpenCodeVersion.mockRejectedValueOnce(new Error('Unexpected error'))
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toBeDefined()
    })

    it('should not crash when getVersion throws error during failure recovery', async () => {
      mockGetVersion.mockImplementationOnce(() => '2.0.14')
          .mockImplementationOnce(() => {
            throw new Error('GetVersion failed')
          })
      mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
      mockInstallOpenCodeVersion.mockRejectedValueOnce(new Error('install failed'))
      mockRestart.mockResolvedValue(undefined)

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toBeDefined()
    })

    it('should handle fetchVersion throwing error during normal upgrade', async () => {
      mockGetVersion.mockReturnValueOnce('2.0.14')
        .mockReturnValueOnce('2.0.14')
      mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
      mockFetchVersion.mockRejectedValueOnce(new Error('Fetch version failed'))
      mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

      const req = new Request('http://localhost/opencode-upgrade', {
        method: 'POST'
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(400)
      expect(json.recovered).toBe(true)
      expect(mockRestart).toHaveBeenCalledTimes(1)
    })

    it('should not leave server in broken state when the install fails', async () => {
      mockGetVersion.mockReturnValueOnce('2.0.14')
          .mockReturnValueOnce('2.0.14')
      mockLatestOpenCodeVersion.mockResolvedValueOnce('2.0.15')
      mockInstallOpenCodeVersion.mockRejectedValueOnce(new Error('install failed'))
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
    const validConfigFile = {
      path: '/tmp/test-workspace/.config/opencode.json',
      content: {},
      rawContent: '{}',
      isValid: true,
      updatedAt: 1,
    }
    let openCodeClient: ReturnType<typeof createStubOpenCodeClient>
    let app: ReturnType<typeof createSettingsRoutes>
    let supervisor: { restart: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      vi.clearAllMocks()
      mockReadOpenCodeConfigFile.mockReset()
      mockRestart.mockReset()
      openCodeClient = createStubOpenCodeClient()
      supervisor = { restart: vi.fn().mockResolvedValue({ healthy: true }) }
      app = createSettingsRoutes(
        testDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        openCodeClient,
        supervisor as any,
      )
    })

    it('reloads the OpenCode configuration without restarting the server when the config is valid', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(validConfigFile)

      const res = await app.fetch(new Request('http://localhost/opencode-reload', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json).toEqual({ success: true, message: 'OpenCode configuration reloaded' })
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(supervisor.restart).not.toHaveBeenCalled()
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('should propagate validationIssues and not reload when the config is invalid', async () => {
      const validationIssues = [
        { path: 'command.review', message: 'Invalid field' },
        { path: 'agent.temperature', message: 'Temperature out of range' }
      ]

      mockReadOpenCodeConfigFile.mockResolvedValueOnce({ ...validConfigFile, isValid: false, validationIssues })

      const res = await app.fetch(new Request('http://localhost/opencode-reload', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('OpenCode global configuration is invalid')
      expect(json.details).toBe('command.review: Invalid field; agent.temperature: Temperature out of range')
      expect(json.validationIssues).toEqual(validationIssues)
      expect(openCodeClient.api.location.reload).not.toHaveBeenCalled()
    })

    it('should return 500 and not reload when every global config source is absent', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(null)

      const res = await app.fetch(new Request('http://localhost/opencode-reload', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('No OpenCode global configuration files found')
      expect(json.details).toBe('No OpenCode global configuration files found')
      expect(openCodeClient.api.location.reload).not.toHaveBeenCalled()
    })

    it('should return a generic error when the location reload fails', async () => {
      mockReadOpenCodeConfigFile.mockResolvedValueOnce(validConfigFile)
      vi.mocked(openCodeClient.api.location.reload).mockRejectedValueOnce(new Error('Some other error'))

      const res = await app.fetch(new Request('http://localhost/opencode-reload', { method: 'POST' }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to reload OpenCode configuration')
      expect(json.details).toBe('Some other error')
      expect(supervisor.restart).not.toHaveBeenCalled()
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
      expect(json.interruptedSessions).toEqual([])
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

  describe('PATCH / - restart pending', () => {
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

    it('does not mark the OpenCode server restart pending when only sandbox.gitCredentials changes', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true, gitCredentials: false } },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true, gitCredentials: true } },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true, gitCredentials: true } } }),
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

    it('requires a restart when git credentials change instead of reloading config', async () => {
      const credential = { id: 'cred-1', name: 'gh', host: 'github.com', type: 'pat', token: 'new-token' }
      mockGetSettings.mockReturnValue({
        preferences: { gitCredentials: [{ ...credential, token: 'old-token' }] },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { gitCredentials: [credential] },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitCredentials: [credential] } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBe(true)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('requires a restart when the git identity changes', async () => {
      mockGetSettings.mockReturnValue({
        preferences: { gitIdentity: { name: 'Old', email: 'old@example.com' } },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { gitIdentity: { name: 'New', email: 'new@example.com' } },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitIdentity: { name: 'New', email: 'new@example.com' } } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBe(true)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['server environment variables', { serverEnvVars: [] }, { serverEnvVars: [{ key: 'FOO', value: 'bar' }] }],
      ['disabled default server environment variables', { disabledDefaultServerEnvVars: [] }, { disabledDefaultServerEnvVars: ['NODE_OPTIONS'] }],
    ])('requires a restart when the %s change', async (_label, previous, next) => {
      mockGetSettings.mockReturnValue({ preferences: previous, updatedAt: 1 })
      mockUpdateSettings.mockReturnValue({ preferences: next, updatedAt: 2 })

      const res = await settingsApp.fetch(new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: next }),
      }))
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBe(true)
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('does not require a restart when git credentials are resubmitted unchanged', async () => {
      const credential = { id: 'cred-1', name: 'gh', host: 'github.com', type: 'pat', token: 'same-token' }
      mockGetSettings.mockReturnValue({
        preferences: { gitCredentials: [credential] },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { gitCredentials: [credential] },
        updatedAt: 1,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { gitCredentials: [credential] } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.restartRequired).toBeUndefined()
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })
  })

  describe('PATCH / - sandbox enable guard', () => {
    afterEach(() => {
      forceProcessAttestation(null)
    })

    it('rejects enabling sandboxing with 400 when sandbox capability is unavailable and does not persist settings', async () => {
      mockDetectSandboxCapability.mockReturnValue({
        available: false,
        reason: '/dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host',
      })
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: false } },
        updatedAt: 1,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true } } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('Cannot enable sandboxing: /dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host')
      expect(mockUpdateSettings).not.toHaveBeenCalled()
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('rejects enabling sandboxing with 400 when capability is available but process identity is not attested', async () => {
      forceProcessAttestation(false)
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: false } },
        updatedAt: 1,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: true } } }),
      })
      const res = await settingsApp.fetch(req)
      const json = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(json.error).toBe('Cannot enable sandboxing: process identity attestation is unavailable on this platform (Linux /proc is required)')
      expect(mockUpdateSettings).not.toHaveBeenCalled()
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('enables sandboxing with 200 when capability is available and process identity is attested', async () => {
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
      expect(mockUpdateSettings).toHaveBeenCalledWith({ sandbox: { enabled: true } }, 'default')
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
    })

    it('allows disabling sandboxing with 200 even when capability is unavailable and identity is not attested', async () => {
      mockDetectSandboxCapability.mockReturnValue({
        available: false,
        reason: '/dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host',
      })
      forceProcessAttestation(false)
      mockGetSettings.mockReturnValue({
        preferences: { sandbox: { enabled: true } },
        updatedAt: 1,
      })
      mockUpdateSettings.mockReturnValue({
        preferences: { sandbox: { enabled: false } },
        updatedAt: 2,
      })

      const req = new Request('http://localhost/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { sandbox: { enabled: false } } }),
      })
      const res = await settingsApp.fetch(req)

      expect(res.status).toBe(200)
      expect(mockUpdateSettings).toHaveBeenCalledWith({ sandbox: { enabled: false } }, 'default')
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
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

describe('Settings Routes - versions, directory files, skills, MCP and maintenance', () => {
  let app: ReturnType<typeof createSettingsRoutes>
  let db: Database
  let supervisor: { restart: ReturnType<typeof vi.fn> }
  let openCodeClient: OpenCodeClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawnSync.mockReset()
    mockGetVersion.mockReset()
    mockFetchVersion.mockReset()
    mockRestart.mockReset()
    mockClearStartupError.mockReset()
    mockGetOpenCodeServerPasswordSource.mockReset()
    mockGetStoredOpenCodeServerPasswordState.mockReset()
    mockClearOpenCodeServerPassword.mockReset()
    mockSetOpenCodeServerPassword.mockReset()
    mockRestoreOpenCodeServerPasswordState.mockReset()
    mockListManagedSkills.mockReset()
    mockGetSkill.mockReset()
    mockCreateSkill.mockReset()
    mockUpdateSkill.mockReset()
    mockDeleteSkill.mockReset()
    mockInstallSkillFromGithubTree.mockReset()
    mockInstallSkillFromUploadedFiles.mockReset()
    mockInstallOpenCodeDirectoryFiles.mockReset()
    mockListOpenCodeDirectoryFiles.mockReset()
    mockGetOpenCodeDirectoryFile.mockReset()
    mockUpdateOpenCodeDirectoryFile.mockReset()
    mockDeleteOpenCodeDirectoryFile.mockReset()
    mockDiscoverModelsCached.mockReset()
    mockValidateSSHPrivateKey.mockReset()

    db = new Database(':memory:')
    migrate(db, allMigrations)
    supervisor = {
      restart: vi.fn().mockResolvedValue({ healthy: true }),
    }
    openCodeClient = createStubOpenCodeClient()
    mockReadOpenCodeConfigFile.mockReset().mockResolvedValue({ isValid: true })
    app = createSettingsRoutes(
      db,
      { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
      openCodeClient,
      supervisor as any,
    )
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    clearOpenCodeVersionCache()
    mockGetVersion.mockReturnValue('2.0.15')
    mockFetchVersion.mockResolvedValue('2.0.15')
    mockInstallOpenCodeVersion.mockReset()
    mockInstallOpenCodeVersion.mockResolvedValue('/home/node/.opencode/bin/opencode')
    mockLatestOpenCodeVersion.mockReset()
    mockLatestOpenCodeVersion.mockResolvedValue('2.0.15')
    mockClearStartupError.mockReturnValue(undefined)
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    mockValidateSSHPrivateKey.mockResolvedValue({ valid: true, hasPassphrase: false })
    mockGetOpenCodeServerPasswordSource.mockReturnValue('managed')
    mockGetStoredOpenCodeServerPasswordState.mockReturnValue(null)
  })

  afterEach(() => {
    db.close()
    vi.unstubAllGlobals()
  })

  describe('GET /opencode-versions', () => {
    it('returns supported OpenCode 2 releases from the npm registry with the current version', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        versions: {
          '1.18.32': {},
          '2.0.14': {},
          '2.0.15': {},
          '2.0.16': {},
          '2.1.0-beta.1': {},
          '3.0.0': {},
        },
        time: {
          '2.0.15': '2026-01-02T00:00:00Z',
          '2.0.16': '2026-01-03T00:00:00Z',
        },
      }), { status: 200 }))

      const res = await app.request(new Request('http://localhost/opencode-versions'))
      const json = await res.json() as { versions: Array<{ version: string; tag: string; name: string; publishedAt: string | null }>; currentVersion: string }

      expect(res.status).toBe(200)
      expect(json.currentVersion).toBe('2.0.15')
      expect(json.versions).toEqual([
        { version: '2.0.16', tag: 'v2.0.16', name: 'v2.0.16', publishedAt: '2026-01-03T00:00:00Z' },
        { version: '2.0.15', tag: 'v2.0.15', name: 'v2.0.15', publishedAt: '2026-01-02T00:00:00Z' },
      ])
      expect(fetchMock).toHaveBeenCalledWith('https://registry.npmjs.org/@opencode/cli')
    })

    it('serves repeated requests from the installer cache', async () => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ versions: { '2.0.15': {} }, time: {} }), { status: 200 }))

      await app.request(new Request('http://localhost/opencode-versions'))
      const res = await app.request(new Request('http://localhost/opencode-versions'))

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns 500 when the registry request fails', async () => {
      fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }))

      const res = await app.request(new Request('http://localhost/opencode-versions'))
      const json = await res.json() as { error: string; details: string }

      expect(res.status).toBe(500)
      expect(json.error).toBe('Failed to fetch versions')
      expect(json.details).toContain('503')
    })
  })

  describe('POST /opencode-install-version', () => {
    it('installs the requested version and restarts the server', async () => {
      mockGetVersion.mockReturnValue('2.0.14')
      mockFetchVersion.mockResolvedValue('2.0.15')
      mockInstallOpenCodeVersion.mockResolvedValueOnce('/home/node/.opencode/bin/opencode')

      const res = await app.request(new Request('http://localhost/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '2.0.15' }),
      }))
      const json = await res.json() as { success: boolean; message: string; oldVersion: string; newVersion: string }

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.oldVersion).toBe('2.0.14')
      expect(json.newVersion).toBe('2.0.15')
      expect(json.message).toContain('changed from v2.0.14 to v2.0.15')
      expect(supervisor.restart).toHaveBeenCalledTimes(1)
      expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.0.15')
    })

    it('returns 500 without recovery when the version install fails and the server cannot be recovered', async () => {
      mockGetVersion.mockReturnValue('2.0.14')
      mockFetchVersion.mockResolvedValue('2.0.15')
      mockInstallOpenCodeVersion.mockRejectedValueOnce(new Error('download failed'))
      supervisor.restart.mockResolvedValue({ healthy: false })

      const res = await app.request(new Request('http://localhost/opencode-install-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '2.0.15' }),
      }))
      const json = await res.json() as { recovered: boolean; newVersion: string }

      expect(res.status).toBe(500)
      expect(json.recovered).toBe(false)
      expect(json.newVersion).toBe('2.0.14')
    })
  })

  describe('OpenCode directory file routes', () => {
    it('lists directory files by kind', async () => {
      mockListOpenCodeDirectoryFiles.mockResolvedValue([
        { kind: 'agents', name: 'assistant', relativePath: 'assistant.md' },
      ])

      const res = await app.request(new Request('http://localhost/opencode-directory-files?kind=agents'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        { kind: 'agents', name: 'assistant', relativePath: 'assistant.md' },
      ])
      expect(mockListOpenCodeDirectoryFiles).toHaveBeenCalledWith('agents')
    })

    it('returns 400 when the directory file kind is invalid', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files?kind=unknown'))

      expect(res.status).toBe(400)
    })

    it('returns a directory file and its content', async () => {
      mockGetOpenCodeDirectoryFile.mockResolvedValue({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        content: 'Review the changes',
      })

      const res = await app.request(new Request('http://localhost/opencode-directory-files/content?kind=commands&relativePath=review.md'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        content: 'Review the changes',
      })
    })

    it('returns 404 when the directory file does not exist', async () => {
      mockGetOpenCodeDirectoryFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const res = await app.request(new Request('http://localhost/opencode-directory-files/content?kind=agents&relativePath=missing.md'))

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'File not found' })
    })

    it('returns 400 when the content query is invalid', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files/content?kind=agents'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid request', details: expect.any(Array) })
    })

    it('updates a directory file and reloads OpenCode', async () => {
      mockUpdateOpenCodeDirectoryFile.mockResolvedValue({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
      })

      const res = await app.request(new Request('http://localhost/opencode-directory-files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commands', relativePath: 'review.md', content: 'Updated' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'commands',
        name: 'review',
        relativePath: 'review.md',
        restartRequired: false,
      })
      expect(mockUpdateOpenCodeDirectoryFile).toHaveBeenCalledWith('commands', 'review.md', 'Updated')
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('returns 400 when updating a directory file with an invalid body', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commands' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid request', details: expect.any(Array) })
      expect(mockUpdateOpenCodeDirectoryFile).not.toHaveBeenCalled()
    })

    it('deletes a directory file and reloads OpenCode', async () => {
      mockDeleteOpenCodeDirectoryFile.mockResolvedValue(undefined)

      const res = await app.request(new Request('http://localhost/opencode-directory-files?kind=agents&relativePath=assistant.md', {
        method: 'DELETE',
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ kind: 'agents', relativePath: 'assistant.md', restartRequired: false })
      expect(mockDeleteOpenCodeDirectoryFile).toHaveBeenCalledWith('agents', 'assistant.md')
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('returns 400 when installing directory files without multipart form data', async () => {
      const res = await app.request(new Request('http://localhost/opencode-directory-files/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'agents' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Unsupported content type. Use multipart/form-data' })
    })

    it('installs uploaded directory files and reloads OpenCode', async () => {
      mockInstallOpenCodeDirectoryFiles.mockResolvedValue({ kind: 'agents', filesInstalled: ['assistant.md'] })

      const formData = new FormData()
      formData.set('kind', 'agents')
      formData.set('fileManifest', JSON.stringify([{ fieldName: 'file0', relativePath: 'assistant.md' }]))
      formData.set('file0', new File(['# Assistant'], 'assistant.md', { type: 'text/markdown' }))

      const res = await app.request(new Request('http://localhost/opencode-directory-files/install', {
        method: 'POST',
        body: formData,
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'agents',
        filesInstalled: ['assistant.md'],
        restartRequired: false,
      })
      expect(mockInstallOpenCodeDirectoryFiles).toHaveBeenCalledWith('agents', [
        { relativePath: 'assistant.md', content: expect.any(Buffer) },
      ])
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })
  })

  describe('PUT /agents-md', () => {
    it('writes AGENTS.md and reloads OpenCode without restarting the server', async () => {
      const res = await app.request(new Request('http://localhost/agents-md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Rules' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true, restartRequired: false })
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(supervisor.restart).not.toHaveBeenCalled()
    })
  })

  describe('Skill routes', () => {
    it('lists managed skills', async () => {
      mockListManagedSkills.mockResolvedValue([
        { name: 'review', description: 'Review changes', body: 'body', scope: 'global', location: '/tmp/review' },
      ])

      const res = await app.request(new Request('http://localhost/skills'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        { name: 'review', description: 'Review changes', body: 'body', scope: 'global', location: '/tmp/review' },
      ])
      expect(mockListManagedSkills).toHaveBeenCalledWith(db, expect.anything(), undefined, undefined)
    })

    it('returns a skill by name and scope', async () => {
      mockGetSkill.mockResolvedValue({
        name: 'review',
        description: 'Review changes',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
      })

      const res = await app.request(new Request('http://localhost/skills/review?scope=global'))

      expect(res.status).toBe(200)
      expect(mockGetSkill).toHaveBeenCalledWith(db, expect.anything(), 'review', 'global', undefined)
    })

    it('returns 400 for an invalid skill scope', async () => {
      const res = await app.request(new Request('http://localhost/skills/review?scope=invalid'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid scope parameter. Must be "global" or "project"' })
    })

    it('returns 400 when a project skill is requested without a repoId', async () => {
      const res = await app.request(new Request('http://localhost/skills/review?scope=project'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'repoId is required for project scope' })
    })

    it('returns 404 when the skill does not exist', async () => {
      mockGetSkill.mockRejectedValue(new Error('Skill not found'))

      const res = await app.request(new Request('http://localhost/skills/review?scope=global'))

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Skill not found' })
    })

    it('creates a skill and reloads OpenCode', async () => {
      mockCreateSkill.mockResolvedValue({
        name: 'review',
        description: 'Review changes',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
      })

      const res = await app.request(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'body', scope: 'global' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        name: 'review',
        description: 'Review changes',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
        restartRequired: false,
      })
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('returns 409 when creating a skill that already exists', async () => {
      mockCreateSkill.mockRejectedValue(new Error('Skill already exists'))

      const res = await app.request(new Request('http://localhost/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'review', description: 'Review changes', body: 'body', scope: 'global' }),
      }))

      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'Skill already exists' })
    })

    it('updates a skill and reloads OpenCode', async () => {
      mockUpdateSkill.mockResolvedValue({
        name: 'review',
        description: 'Updated',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
      })

      const res = await app.request(new Request('http://localhost/skills/review?scope=global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        name: 'review',
        description: 'Updated',
        body: 'body',
        scope: 'global',
        location: '/tmp/review',
        restartRequired: false,
      })
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('deletes a skill and reloads OpenCode', async () => {
      mockDeleteSkill.mockResolvedValue(undefined)

      const res = await app.request(new Request('http://localhost/skills/review?scope=global', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true, restartRequired: false })
      expect(mockDeleteSkill).toHaveBeenCalledWith(db, 'review', 'global', undefined)
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('marks a restart pending when reloading OpenCode after a skill change fails', async () => {
      mockDeleteSkill.mockResolvedValue(undefined)
      vi.mocked(openCodeClient.api.location.reload).mockRejectedValueOnce(new Error('OpenCode server unavailable'))

      const res = await app.request(new Request('http://localhost/skills/review?scope=global', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true, restartRequired: true })
      expect(opencodeServerManager.markRestartPending).toHaveBeenCalledTimes(1)
      expect(supervisor.restart).not.toHaveBeenCalled()
    })

    it('returns 400 when installing a project skill without a repoId', async () => {
      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill', scope: 'project' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'repoId is required for project scope' })
    })

    it('installs a global skill from a GitHub tree and reloads OpenCode', async () => {
      mockInstallSkillFromGithubTree.mockResolvedValue({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
      })

      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill', scope: 'global' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
        restartRequired: false,
      })
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
    })

    it('reloads OpenCode for a project skill without restarting the server', async () => {
      const repo = createRepo(db, { localPath: 'project-repo', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
      mockInstallSkillFromGithubTree.mockResolvedValue({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'project', location: '/tmp/review', repoId: repo.id },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
      })

      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'github', url: 'https://github.com/example/skill', scope: 'project', repoId: repo.id }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'project', location: '/tmp/review', repoId: repo.id },
        overwritten: false,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
        restartRequired: false,
      })
      expect(opencodeServerManager.markRestartPending).not.toHaveBeenCalled()
      expect(supervisor.restart).not.toHaveBeenCalled()
      expect(openCodeClient.api.location.reload).toHaveBeenCalledTimes(1)
      expect(mockInstallSkillFromGithubTree).toHaveBeenCalledWith(db, expect.objectContaining({ scope: 'project', repoId: repo.id }))
    })

    it('installs an uploaded skill from multipart form data', async () => {
      mockInstallSkillFromUploadedFiles.mockResolvedValue({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'upload',
        filesInstalled: ['SKILL.md'],
      })

      const formData = new FormData()
      formData.set('scope', 'global')
      formData.set('fileManifest', JSON.stringify([{ fieldName: 'file0', relativePath: 'review/SKILL.md' }]))
      formData.set('file0', new File(['---\nname: review\ndescription: Review\n---\nbody'], 'SKILL.md', { type: 'text/markdown' }))

      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        body: formData,
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        skill: { name: 'review', description: 'Review', body: 'body', scope: 'global', location: '/tmp/review' },
        overwritten: false,
        sourceType: 'upload',
        filesInstalled: ['SKILL.md'],
        restartRequired: false,
      })
      expect(mockInstallSkillFromUploadedFiles).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ sourceType: 'upload', scope: 'global' }),
        [{ relativePath: 'review/SKILL.md', content: expect.any(Buffer) }],
      )
    })

    it('returns 400 when installing a skill with an unsupported content type', async () => {
      const res = await app.request(new Request('http://localhost/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not a skill',
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Unsupported content type. Use application/json or multipart/form-data' })
    })
  })

  describe('POST /test-ssh', () => {
    it('returns 400 when the SSH key is invalid', async () => {
      mockValidateSSHPrivateKey.mockResolvedValue({ valid: false, hasPassphrase: false, error: 'Invalid SSH key' })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: 'not-a-key' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ success: false, message: 'Invalid SSH key' })
    })

    it('reports a successful SSH authentication', async () => {
      mockSpawnSync.mockReturnValue({ status: 255, stdout: '', stderr: "debug1: Authentication succeeded\nYou've successfully authenticated" })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'git@example.com:2222', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true, message: 'Successfully connected to git@example.com:2222' })
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining(['-p', '2222', 'git@example.com']),
        expect.objectContaining({ timeout: 30000 }),
      )
    })

    it('reports a timeout when the SSH command is killed', async () => {
      mockSpawnSync.mockReturnValue({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----' }),
      }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        success: false,
        message: 'Connection timed out. This may indicate a network issue or an incorrect host.',
      })
    })

    it('reports permission denied, unknown host, and refused connection details', async () => {
      const cases = [
        { output: 'Permission denied (publickey)', message: 'Permission denied. The SSH key may not be authorized on this host, or the passphrase is incorrect.' },
        { output: 'Could not resolve hostname example.com', message: 'Could not resolve hostname. Please check that the host is correct and accessible.' },
        { output: 'ssh: connect to host example.com port 22: Connection refused', message: 'Connection refused or timed out. The host may be down or not accepting SSH connections.' },
      ]

      for (const testCase of cases) {
        mockSpawnSync.mockReturnValue({ status: 255, stdout: '', stderr: testCase.output })

        const res = await app.request(new Request('http://localhost/test-ssh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: 'example.com', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----' }),
        }))

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ success: false, message: testCase.message })
      }
    })

    it('reports ambiguous SSH output and uses sshpass when a passphrase is provided', async () => {
      mockSpawnSync.mockReturnValue({ status: 255, stdout: '', stderr: 'debug1: no matching host key' })

      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----', passphrase: 'secret' }),
      }))

      expect(res.status).toBe(200)
      const json = await res.json() as { success: boolean; message: string }
      expect(json.success).toBe(false)
      expect(json.message).toContain('Authentication failed')
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'sshpass',
        expect.arrayContaining(['-e', 'ssh']),
        expect.objectContaining({ env: expect.objectContaining({ SSHPASS: 'secret' }) }),
      )
    })

    it('returns 400 for an invalid test-ssh body', async () => {
      const res = await app.request(new Request('http://localhost/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'example.com' }),
      }))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid request data', details: expect.any(Array) })
    })
  })


  describe('OpenCode server auth routes', () => {
    it('reports the configured source for the server password', async () => {
      mockGetOpenCodeServerPasswordSource.mockReturnValue('managed')

      const res = await app.request(new Request('http://localhost/opencode-server-auth'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ isSet: true, source: 'managed' })
    })

    it('clears the server password and reconnects the SSE aggregator', async () => {
      mockGetStoredOpenCodeServerPasswordState.mockReturnValue({ source: 'db' })
      mockGetOpenCodeServerPasswordSource.mockReturnValue('managed')

      const res = await app.request(new Request('http://localhost/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      }))

      expect(res.status).toBe(200)
      expect(mockClearOpenCodeServerPassword).toHaveBeenCalledTimes(1)
      expect(mockSetOpenCodeServerPassword).not.toHaveBeenCalled()
      expect(await res.json()).toEqual({ isSet: true, source: 'managed' })
    })

    it('restores the previous password state when the restart fails', async () => {
      mockGetStoredOpenCodeServerPasswordState.mockReturnValue({ source: 'db' })
      supervisor.restart.mockResolvedValue({ healthy: false })

      const res = await app.request(new Request('http://localhost/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'new-password' }),
      }))

      expect(res.status).toBe(500)
      expect(mockSetOpenCodeServerPassword).toHaveBeenCalledWith('new-password')
      expect(mockRestoreOpenCodeServerPasswordState).toHaveBeenCalledWith({ source: 'db' })
      expect(await res.json()).toEqual({ error: 'Failed to update OpenCode server auth' })
    })
  })

  describe('Maintenance routes', () => {
    it('returns the manager token', async () => {
      const res = await app.request(new Request('http://localhost/manager-token'))

      expect(res.status).toBe(200)
      const json = await res.json() as { token: string }
      expect(json.token).toBe(getOrCreateInternalToken(db))
    })

    it('returns 500 when the manager token cannot be read', async () => {
      const brokenDb = {
        prepare: vi.fn(() => {
          throw new Error('database is unavailable')
        }),
      } as any
      const brokenApp = createSettingsRoutes(
        brokenDb,
        { getGitEnvironment: vi.fn().mockReturnValue({}) } as any,
        createStubOpenCodeClient(),
        supervisor as any,
      )

      const res = await brokenApp.request(new Request('http://localhost/manager-token'))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to get manager token' })
    })

    it('returns active user sessions from the SSE aggregator', async () => {
      const activeSpy = vi.spyOn(sseAggregator, 'getActiveSessions').mockReturnValue({ '/repo': ['session-1'] })

      try {
        const res = await app.request(new Request('http://localhost/opencode-active-sessions'))

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ count: 1, sessions: [{ sessionID: 'session-1', directory: '/repo' }] })
      } finally {
        activeSpy.mockRestore()
      }
    })

    it('returns an empty session list when no session is active', async () => {
      const res = await app.request(new Request('http://localhost/opencode-active-sessions'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ count: 0, sessions: [] })
    })

    it('validates the model discovery baseUrl', async () => {
      const missing = await app.request(new Request('http://localhost/opencode-discover-models'))
      expect(missing.status).toBe(400)
      expect(await missing.json()).toEqual({ error: 'baseUrl is required' })

      const invalid = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=not-a-url'))
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: 'Invalid baseUrl' })

      const nonHttp = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=ftp://example.com'))
      expect(nonHttp.status).toBe(400)
      expect(await nonHttp.json()).toEqual({ error: 'baseUrl must be an http or https URL' })
    })

    it('discovers and returns models with the cache flag', async () => {
      mockDiscoverModelsCached.mockResolvedValue({ models: [{ id: 'gpt-4' }], cached: false })

      const res = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=https://api.example.com&apiKey=secret&refresh=true'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ models: [{ id: 'gpt-4' }], cached: false })
      expect(mockDiscoverModelsCached).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com',
        apiKey: 'secret',
        type: 'opencode-models',
        filterPattern: /.*/,
        defaultModels: [],
        forceRefresh: true,
      })
    })

    it('returns 500 when model discovery fails', async () => {
      mockDiscoverModelsCached.mockRejectedValue(new Error('discovery failed'))

      const res = await app.request(new Request('http://localhost/opencode-discover-models?baseUrl=https://api.example.com'))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to discover models' })
    })
  })
})
