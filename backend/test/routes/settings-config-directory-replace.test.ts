import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'

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
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    saveLastKnownGoodConfig: vi.fn(),
    createOpenCodeConfig: vi.fn(),
    updateOpenCodeConfig: vi.fn(),
    deleteOpenCodeConfig: vi.fn(),
    getOpenCodeConfigByName: vi.fn(),
    setDefaultOpenCodeConfig: vi.fn(),
  })),
}))

vi.mock('../../src/services/file-operations', () => ({
  writeFileContent: vi.fn(),
  readFileContent: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock('../../src/services/opencode-single-server', () => {
  class MockConfigReloadError extends Error {
    validationIssues: Array<{ path: string; message: string }> = []
    removedFields: string[] = []
    constructor(message: string) {
      super(message)
      this.name = 'ConfigReloadError'
    }
  }

  return {
    opencodeServerManager: {
      getVersion: vi.fn(),
      fetchVersion: vi.fn(),
      reloadConfig: vi.fn(),
      restart: vi.fn(),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(),
      markRestartPending: vi.fn(),
      isRestartPending: vi.fn(),
      setDatabase: vi.fn(),
      reinitializeBinDirectory: vi.fn(),
    },
    ConfigReloadError: MockConfigReloadError,
  }
})

vi.mock('../../src/services/opencode-restart', () => ({
  restartOpenCode: vi.fn().mockResolvedValue({ resumedSessionIDs: [] }),
  reloadOpenCodeConfig: vi.fn(),
  getOpenCodeRestartCoordinator: vi.fn(() => null),
  setOpenCodeRestartCoordinator: vi.fn(),
}))

vi.mock('../../src/services/skills', () => ({
  listManagedSkills: vi.fn(),
  getSkill: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  installSkillFromGithubTree: vi.fn(),
  installSkillFromUploadedFiles: vi.fn(),
}))

vi.mock('../../src/services/opencode-config-directory', () => ({
  replaceOpenCodeConfigDirectory: vi.fn(),
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
import { SettingsService } from '../../src/services/settings'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { restartOpenCode } from '../../src/services/opencode-restart'
import { replaceOpenCodeConfigDirectory } from '../../src/services/opencode-config-directory'
import { writeFileContent, fileExists } from '../../src/services/file-operations'

const mockReplace = replaceOpenCodeConfigDirectory as ReturnType<typeof vi.fn>
const mockRestartOpenCode = restartOpenCode as ReturnType<typeof vi.fn>
const mockMarkRestartPending = opencodeServerManager.markRestartPending as ReturnType<typeof vi.fn>
const mockClearStartupError = opencodeServerManager.clearStartupError as ReturnType<typeof vi.fn>
const mockWriteFileContent = writeFileContent as ReturnType<typeof vi.fn>
const mockFileExists = fileExists as ReturnType<typeof vi.fn>

const mockReplaceResult = {
  configSourceFilename: 'opencode.json',
  filesInstalled: ['opencode.json', 'agents/team/lead.md'],
  skippedPaths: ['node_modules/package/dist/index.js'],
  preservedEntries: ['node_modules'],
  executablesRestored: ['scripts/deploy.sh'],
}

function createZodError(): z.ZodError {
  try {
    z.object({ name: z.string() }).parse({})
  } catch (error) {
    return error as z.ZodError
  }
  throw new Error('unreachable')
}

describe('Settings Routes - OpenCode Config Directory Replace', () => {
  let settingsApp: ReturnType<typeof createSettingsRoutes>
  let testDb: any
  let mockSaveLastKnownGoodConfig: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockReplace.mockResolvedValue(mockReplaceResult)
    mockRestartOpenCode.mockResolvedValue({ resumedSessionIDs: [] })
    mockFileExists.mockResolvedValue(false)

    testDb = {} as any
    settingsApp = createSettingsRoutes(testDb, { getGitEnvironment: vi.fn().mockReturnValue({}) } as any, createStubOpenCodeClient())
    const settingsInstance = (SettingsService as unknown as { mock: { results: Array<{ value: any }> } }).mock.results[0]!.value
    mockSaveLastKnownGoodConfig = settingsInstance.saveLastKnownGoodConfig
  })

  function buildFormData(): FormData {
    const formData = new FormData()
    formData.append('fileManifest', JSON.stringify([
      { fieldName: 'file0', relativePath: 'opencode.json' },
      { fieldName: 'file1', relativePath: 'agents/team/lead.md' },
    ]))
    formData.append('file0', new File(['{"name":"test"}'], 'opencode.json', { type: 'application/json' }))
    formData.append('file1', new File(['# Lead'], 'lead.md', { type: 'text/markdown' }))
    return formData
  }

  describe('POST /opencode-config-directory/replace', () => {
    it('replaces the config directory, re-ensures AGENTS.md, and restarts the server', async () => {
      const res = await settingsApp.request('/opencode-config-directory/replace?userId=custom', {
        method: 'POST',
        body: buildFormData(),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body).toEqual(mockReplaceResult)
      expect('restartRequired' in body).toBe(false)
      expect('configDirectory' in body).toBe(false)

      expect(mockReplace).toHaveBeenCalledTimes(1)
      expect(mockReplace).toHaveBeenCalledWith(
        testDb,
        [
          expect.objectContaining({ relativePath: 'opencode.json', file: expect.any(File) }),
          expect.objectContaining({ relativePath: 'agents/team/lead.md', file: expect.any(File) }),
        ],
        'custom',
      )
      expect(mockSaveLastKnownGoodConfig).toHaveBeenCalledWith('custom')
      expect(mockWriteFileContent).toHaveBeenCalledWith('/tmp/test-workspace/AGENTS.md', '# Test Agents MD')
      expect(mockMarkRestartPending).toHaveBeenCalledTimes(1)
      expect(mockClearStartupError).toHaveBeenCalledTimes(1)
      expect(mockRestartOpenCode).toHaveBeenCalledTimes(1)
      expect(mockRestartOpenCode).toHaveBeenCalledWith(undefined)
      expect(mockSaveLastKnownGoodConfig.mock.invocationCallOrder[0]).toBeLessThan(mockMarkRestartPending.mock.invocationCallOrder[0]!)
      expect(mockMarkRestartPending.mock.invocationCallOrder[0]).toBeLessThan(mockRestartOpenCode.mock.invocationCallOrder[0]!)
    })

    it('rejects non-multipart requests with 400', async () => {
      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Unsupported content type. Use multipart/form-data')
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('returns 400 with the service message when the root config file is missing', async () => {
      mockReplace.mockRejectedValue(new Error('Uploaded directory must contain opencode.json or opencode.jsonc at its root'))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: buildFormData(),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Uploaded directory must contain opencode.json or opencode.jsonc at its root')
    })

    it('maps oversize uploads to 413', async () => {
      mockReplace.mockRejectedValue(new Error('Uploaded config directory files exceed maximum upload size'))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: buildFormData(),
      })

      expect(res.status).toBe(413)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Uploaded config directory files exceed maximum upload size')
    })

    it('maps too-many-files errors to 400', async () => {
      mockReplace.mockRejectedValue(new Error('Uploaded config directory contains too many files (max 5000)'))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: buildFormData(),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Uploaded config directory contains too many files (max 5000)')
    })

    it('rejects an over-count manifest with 400 before reading any file content', async () => {
      const manifest = Array.from({ length: 5001 }, (_, index) => ({
        fieldName: `file${index}`,
        relativePath: `dir/file${index}.md`,
      }))
      const formData = new FormData()
      formData.append('fileManifest', JSON.stringify(manifest))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Uploaded config directory contains too many files (max 5000)')
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('reports invalid config content as a ZodError 400 with issue details', async () => {
      mockReplace.mockRejectedValue(createZodError())

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: buildFormData(),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string; details: unknown[] }
      expect(body.error).toBe('Uploaded OpenCode config is invalid')
      expect(body.details).toHaveLength(1)
    })

    it('rejects a malformed fileManifest as invalid upload data, not config content', async () => {
      const formData = new FormData()
      formData.append('fileManifest', JSON.stringify([{ fieldName: 'file0' }]))
      formData.append('file0', new File(['{"name":"test"}'], 'opencode.json', { type: 'application/json' }))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Invalid upload manifest')
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('rejects an empty manifest with 400', async () => {
      const formData = new FormData()
      formData.append('fileManifest', JSON.stringify([]))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('fileManifest must contain at least one entry')
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('rejects missing manifest fields with the upload validation message', async () => {
      const formData = new FormData()
      formData.append('fileManifest', JSON.stringify([
        { fieldName: 'file0', relativePath: 'opencode.json' },
      ]))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Missing upload file(s): file0')
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('maps a "." manifest relative path to 400 instead of 500', async () => {
      mockReplace.mockRejectedValue(new Error('Path must not be empty'))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: buildFormData(),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Path must not be empty')
    })

    it('returns 500 when the replace itself fails without restarting', async () => {
      mockReplace.mockRejectedValue(new Error('unexpected failure'))

      const res = await settingsApp.request('/opencode-config-directory/replace', {
        method: 'POST',
        body: buildFormData(),
      })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Failed to replace OpenCode config directory')
      expect(mockMarkRestartPending).not.toHaveBeenCalled()
      expect(mockRestartOpenCode).not.toHaveBeenCalled()
    })
  })
})
