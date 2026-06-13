import { describe, it, expect, vi, beforeEach } from 'vitest'
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
      setDatabase: vi.fn(),
      reinitializeBinDirectory: vi.fn(),
    },
    ConfigReloadError: MockConfigReloadError,
  }
})

vi.mock('../../src/services/skills', () => ({
  listManagedSkills: vi.fn(),
  getSkill: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  installSkillFromGithubTree: vi.fn(),
  installSkillFromUploadedFiles: vi.fn(),
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
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import {
  installSkillFromGithubTree,
  installSkillFromUploadedFiles,
  deleteSkill,
} from '../../src/services/skills'

const mockInstallFromGithubTree = installSkillFromGithubTree as ReturnType<typeof vi.fn>
const mockInstallFromUploadedFiles = installSkillFromUploadedFiles as ReturnType<typeof vi.fn>
const mockDeleteSkill = deleteSkill as ReturnType<typeof vi.fn>
const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>

const mockSuccessResponse = {
  skill: {
    name: 'teach',
    description: 'A teaching skill',
    body: '## Teach\n\nContent',
    scope: 'global',
    location: '/tmp/test-workspace/.config/opencode/skills/teach/SKILL.md',
  },
  overwritten: false,
  sourceType: 'github' as const,
  filesInstalled: ['teach/SKILL.md'],
}

describe('Settings Routes - Skill Install', () => {
  let settingsApp: ReturnType<typeof createSettingsRoutes>
  let testDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockRestart.mockResolvedValue(undefined)
    mockInstallFromGithubTree.mockResolvedValue(mockSuccessResponse)
    mockInstallFromUploadedFiles.mockResolvedValue({ ...mockSuccessResponse, sourceType: 'upload' })

    testDb = {} as any
    settingsApp = createSettingsRoutes(testDb, { getGitEnvironment: vi.fn().mockReturnValue({}) } as any, createStubOpenCodeClient())
  })

  describe('POST /skills/install', () => {
    it('installs from GitHub JSON', async () => {
      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'github',
          url: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
          scope: 'global',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body).toEqual(mockSuccessResponse)
      expect(mockInstallFromGithubTree).toHaveBeenCalledTimes(1)
      expect(mockInstallFromGithubTree).toHaveBeenCalledWith(testDb, {
        sourceType: 'github',
        url: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
        scope: 'global',
      })
      expect(mockRestart).toHaveBeenCalledTimes(1)
    })

    it('installs from multipart upload', async () => {
      const formData = new FormData()
      formData.append('scope', 'global')
      formData.append('sourceType', 'upload')
      formData.append('fileManifest', JSON.stringify([
        { fieldName: 'file0', relativePath: 'teach/SKILL.md' },
      ]))
      formData.append('file0', new File(['---\nname: teach\ndescription: A teaching skill\n---\n## Teach\n\nContent'], 'SKILL.md', { type: 'text/markdown' }))

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { sourceType: string }
      expect(body.sourceType).toBe('upload')
      expect(mockInstallFromUploadedFiles).toHaveBeenCalledTimes(1)
      expect(mockInstallFromUploadedFiles).toHaveBeenCalledWith(
        testDb,
        {
          sourceType: 'upload',
          scope: 'global',
          repoId: undefined,
          overwrite: undefined,
        },
        [
          expect.objectContaining({
            relativePath: 'teach/SKILL.md',
            content: expect.any(Buffer),
          }),
        ],
      )
      expect(mockRestart).toHaveBeenCalledTimes(1)
    })

    it('returns 409 on existing skill', async () => {
      mockInstallFromGithubTree.mockRejectedValue(new Error('Skill "teach" already exists in global scope'))

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'github',
          url: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
          scope: 'global',
        }),
      })

      expect(res.status).toBe(409)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('already exists')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('rejects project scope without repoId', async () => {
      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'github',
          url: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
          scope: 'project',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('repoId is required')
      expect(mockInstallFromGithubTree).not.toHaveBeenCalled()
    })

    it('rejects invalid repoId in multipart upload', async () => {
      const formData = new FormData()
      formData.append('scope', 'global')
      formData.append('sourceType', 'upload')
      formData.append('repoId', 'abc')
      formData.append('fileManifest', JSON.stringify([
        { fieldName: 'file0', relativePath: 'teach/SKILL.md' },
      ]))
      formData.append('file0', new File(['content'], 'SKILL.md', { type: 'text/markdown' }))

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Invalid repoId')
    })

    it('rejects multiple uploaded skills', async () => {
      mockInstallFromUploadedFiles.mockRejectedValue(new Error('Only one skill can be installed at a time'))

      const formData = new FormData()
      formData.append('scope', 'global')
      formData.append('sourceType', 'upload')
      formData.append('fileManifest', JSON.stringify([
        { fieldName: 'file0', relativePath: 'teach/SKILL.md' },
        { fieldName: 'file1', relativePath: 'review/SKILL.md' },
      ]))
      formData.append('file0', new File(['---\nname: teach\n---\nBody'], 'SKILL.md', { type: 'text/markdown' }))
      formData.append('file1', new File(['---\nname: review\n---\nBody'], 'SKILL.md', { type: 'text/markdown' }))

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Only one skill')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('rejects upload with missing SKILL.md', async () => {
      mockInstallFromUploadedFiles.mockRejectedValue(new Error('Skill source must contain SKILL.md'))

      const formData = new FormData()
      formData.append('scope', 'global')
      formData.append('sourceType', 'upload')
      formData.append('fileManifest', JSON.stringify([
        { fieldName: 'file0', relativePath: 'teach/README.md' },
      ]))
      formData.append('file0', new File(['# Readme'], 'README.md', { type: 'text/markdown' }))

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Skill source must contain')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('rejects unsafe upload path', async () => {
      mockInstallFromUploadedFiles.mockRejectedValue(new Error('Path must not contain "..": "../SKILL.md"'))

      const formData = new FormData()
      formData.append('scope', 'global')
      formData.append('sourceType', 'upload')
      formData.append('fileManifest', JSON.stringify([
        { fieldName: 'file0', relativePath: '../SKILL.md' },
      ]))
      formData.append('file0', new File(['---\nname: teach\n---\nBody'], 'SKILL.md', { type: 'text/markdown' }))

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Path must not contain')
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('rejects non-File manifest field in multipart upload', async () => {
      const formData = new FormData()
      formData.append('scope', 'global')
      formData.append('sourceType', 'upload')
      formData.append('fileManifest', JSON.stringify([
        { fieldName: 'file0', relativePath: 'teach/SKILL.md' },
      ]))
      formData.append('file0', 'not-a-file')

      const res = await settingsApp.request('/skills/install', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('not a valid file')
    })
  })

  describe('DELETE /skills/:name', () => {
    it('remains the deletion endpoint', async () => {
      mockDeleteSkill.mockResolvedValue(undefined)

      const res = await settingsApp.request('/skills/test-skill?scope=global', {
        method: 'DELETE',
      })

      expect(res.status).toBe(200)
      expect(mockDeleteSkill).toHaveBeenCalledWith(testDb, 'test-skill', 'global', undefined)
    })
  })
})
