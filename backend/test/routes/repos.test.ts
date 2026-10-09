import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'

const mockDb = {
  prepare: vi.fn(),
  exec: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn()
} as unknown as Database

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDb)
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
  updateLastAccessed: vi.fn(),
  listRepos: vi.fn(),
  getRepoGitCredentialId: vi.fn(),
  setRepoGitCredentialId: vi.fn(),
  updateRepoName: vi.fn(),
  getRepoSetting: vi.fn(),
  setRepoSetting: vi.fn(),
}))

vi.mock('../../src/services/repo', () => ({
  getCurrentBranch: vi.fn(),
  initLocalRepo: vi.fn(),
  cloneRepo: vi.fn(),
  discoverLocalRepos: vi.fn(),
  pullRepo: vi.fn(),
  switchBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteRepoFiles: vi.fn(),
  getSiblingRepos: vi.fn(),
  listRepoSiblings: vi.fn(),
  resolveRepoOrAssistant: vi.fn(),
  findSiblingByDirectory: vi.fn(),
  resolveRepoWorkingDirectory: vi.fn(),
  resolveRepoProjectId: vi.fn(),
}))

vi.mock('../../src/services/assistant-mode', () => ({
  getAssistantModeStatus: vi.fn(),
  ensureAssistantMode: vi.fn(),
  getAssistantModeDirectory: vi.fn(),
  buildAssistantOpenCodeConfig: vi.fn(),
  buildAssistantRepo: vi.fn(),
}))

vi.mock('../../src/services/archive', () => ({
  createRepoArchive: vi.fn(),
  getArchiveSize: vi.fn(),
  getArchiveStream: vi.fn(),
  deleteArchive: vi.fn(),
}))

const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
  })),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    clearStartupError: vi.fn(),
    restart: vi.fn().mockResolvedValue(undefined),
    isSandboxEnforced: vi.fn(),
  },
}))

import { Readable } from 'stream'
import * as db from '../../src/db/queries'
import * as repoService from '../../src/services/repo'
import * as archiveService from '../../src/services/archive'
import { createRepoRoutes } from '../../src/routes/repos'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { ProjectConfigService } from '../../src/services/project-config'
import { RepoWorkspaceService } from '../../src/services/repo-workspace'
import { createGitService } from '../../src/services/git/GitService'
import type { GitAuthService } from '../../src/services/git-auth'
import type { ScheduleService } from '../../src/services/schedules'
import type { TerminalService } from '../../src/services/terminal'
import type { AssistantModeStatus, Repo } from '@opencode-manager/shared/types'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { ClientError } from '@opencode-manager/shared/opencode'
import { getAssistantModeStatus, ensureAssistantMode, buildAssistantRepo } from '../../src/services/assistant-mode'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({})
} as unknown as GitAuthService

const mockPrepareRepoDelete = vi.fn()
const mockScheduleService = {
  prepareRepoDelete: mockPrepareRepoDelete,
} as unknown as ScheduleService

const mockTerminalService = {
  removeAll: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
} as unknown as TerminalService

function createTestRoutes(openCodeClient: ReturnType<typeof createStubOpenCodeClient> = createStubOpenCodeClient()): ReturnType<typeof createRepoRoutes> {
  const projectConfigService = new ProjectConfigService(mockDb, createGitService(mockGitAuthService), mockGitAuthService)
  const repoWorkspaces = new RepoWorkspaceService(mockDb, openCodeClient, mockGitAuthService, projectConfigService, mockTerminalService, mockScheduleService)
  return createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, openCodeClient, mockTerminalService, projectConfigService, repoWorkspaces)
}

function createMockRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    repoUrl: 'https://github.com/test/repo',
    localPath: 'repos/test-repo',
    fullPath: '/tmp/repos/test-repo',
    sourcePath: '/tmp/repos/test-repo/.git',
    branch: 'main',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    lastAccessedAt: Date.now(),
    ...overrides,
  }
}

describe('Repo Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(opencodeServerManager.isSandboxEnforced).mockReturnValue(false)
    mockGetSettings.mockReturnValue({
      preferences: { repoOrder: [], gitCredentials: [] },
      updatedAt: Date.now(),
    })
    mockUpdateSettings.mockReturnValue({
      preferences: { repoOrder: [] },
      updatedAt: Date.now(),
    })
    vi.mocked(db.getRepoGitCredentialId).mockReturnValue(null)
    vi.mocked(db.getRepoSetting).mockReturnValue(null)
    vi.mocked(repoService.resolveRepoProjectId).mockResolvedValue('commit-A')
    vi.mocked(repoService.listRepoSiblings).mockResolvedValue([])
    vi.mocked(repoService.resolveRepoOrAssistant).mockImplementation(
      (_database, id) => vi.mocked(db.getRepoById)(_database, id) ?? (id === ASSISTANT_REPO_ID ? buildAssistantRepo() : null),
    )
  })

  describe('POST /:id/access', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Repo not found')
    })

    it('should return 200 and call updateLastAccessed when repo exists', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/Users/test/repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now()
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)

      const app = createTestRoutes()
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(db.updateLastAccessed).toHaveBeenCalledWith(mockDb, 1)
    })

    it('should return 500 when updateLastAccessed throws', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/Users/test/repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now()
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)
      vi.mocked(db.updateLastAccessed).mockImplementation(() => {
        throw new Error('Database error')
      })

      const app = createTestRoutes()
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Database error')
    })
  })

  describe('GET /:id/assistant-mode', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/assistant-mode', { method: 'GET' })

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Repo not found')
    })

    it('should call getAssistantModeStatus and return status', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/tmp/test-repo',
        sourcePath: '/tmp/test-repo/.git',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)

      const mockStatus: AssistantModeStatus = {
        repoId: 1,
        directory: '/tmp/workspace/repos/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '/tmp/workspace/repos/assistant/AGENTS.md', exists: false, created: false },
          opencodeJson: { path: '/tmp/workspace/repos/assistant/opencode.json', exists: false, created: false },
        },
      }

      vi.mocked(getAssistantModeStatus).mockResolvedValue(mockStatus)

      const app = createTestRoutes()
      const res = await app.request('/1/assistant-mode', { method: 'GET' })

      expect(res.status).toBe(200)
      const body = await res.json() as typeof mockStatus
      expect(body.repoId).toBe(1)
      expect(body.relativePath).toBe('repos/assistant')

      expect(ensureAssistantMode).not.toHaveBeenCalled()
    })
  })

  describe('POST /:id/assistant-mode', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/assistant-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Repo not found')
    })

    it('should validate body and call ensureAssistantMode', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/tmp/test-repo',
        sourcePath: '/tmp/test-repo/.git',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)

      const mockStatus: AssistantModeStatus = {
        repoId: 1,
        directory: '/tmp/workspace/repos/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '/tmp/workspace/repos/assistant/AGENTS.md', exists: true, created: true },
          opencodeJson: { path: '/tmp/workspace/repos/assistant/opencode.json', exists: true, created: true },
        },
      }

      vi.mocked(ensureAssistantMode).mockResolvedValue(mockStatus)

      const app = createTestRoutes()
      const res = await app.request('/1/assistant-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteAgentsMd: true }),
      })

      expect(res.status).toBe(200)

      const body = await res.json() as typeof mockStatus
      expect(body).toEqual(mockStatus)

      expect(ensureAssistantMode).toHaveBeenCalledTimes(1)
      expect(ensureAssistantMode).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, localPath: 'repos/test-repo' }),
        expect.objectContaining({ overwriteAgentsMd: true }),
      )

      expect(opencodeServerManager.clearStartupError).not.toHaveBeenCalled()
      expect(opencodeServerManager.restart).not.toHaveBeenCalled()
    })

    it('should handle errors from ensureAssistantMode', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/tmp/test-repo',
        sourcePath: '/tmp/test-repo/.git',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)

      vi.mocked(ensureAssistantMode).mockRejectedValue(new Error('Test error'))

      const app = createTestRoutes()
      const res = await app.request('/1/assistant-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(500)
    })
  })

  describe('POST /:id/reset-permissions', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(404)
    })

    it('should return 400 without resolving the project when repo has no directory', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: undefined,
        localPath: 'assistant',
        fullPath: '',
        sourcePath: undefined,
        branch: undefined,
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)

      const locationGet = vi.fn(async () => ({
        directory: '/tmp/test-repo',
        project: { id: 'project-A', directory: '/tmp/test-repo', canonical: '/tmp/test-repo' },
      }))
      const app = createTestRoutes(createStubOpenCodeClient({
        api: { location: { get: locationGet } } as unknown as OpenCodeApi,
      }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(400)
      expect(locationGet).not.toHaveBeenCalled()
    })

    it('should resolve the repo project, remove its saved permissions, and return the removed count', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/test-repo' }))

      const locationGet = vi.fn(async () => ({
        directory: '/tmp/test-repo',
        project: { id: 'project-A', directory: '/tmp/test-repo', canonical: '/tmp/test-repo' },
      }))
      const savedList = vi.fn(async () => [
        { id: 'perm-1', projectID: 'project-A', action: 'bash', resource: '*', time: { created: 1, updated: 1 } },
        { id: 'perm-2', projectID: 'project-A', action: 'edit', resource: '*', time: { created: 2, updated: 2 } },
      ])
      const savedRemove = vi.fn(async () => undefined)

      const app = createTestRoutes(createStubOpenCodeClient({
        api: {
          location: { get: locationGet },
          permission: { saved: { list: savedList, remove: savedRemove } },
        } as unknown as OpenCodeApi,
      }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ removed: 2 })
      expect(locationGet).toHaveBeenCalledWith({ location: { directory: '/tmp/test-repo' } })
      expect(savedList).toHaveBeenCalledWith({ projectID: 'project-A' })
      expect(savedRemove).toHaveBeenCalledTimes(2)
      expect(savedRemove).toHaveBeenCalledWith({ id: 'perm-1' })
      expect(savedRemove).toHaveBeenCalledWith({ id: 'perm-2' })
    })
  })

  describe('POST /', () => {
    it('should return 400 when neither repoUrl nor localPath is provided', async () => {
      const app = createTestRoutes()
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Either repoUrl or localPath is required')
    })

    it('should create a local repo through initLocalRepo', async () => {
      const repo = createMockRepo()
      vi.mocked(repoService.initLocalRepo).mockResolvedValue(repo)

      const app = createTestRoutes()
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localPath: 'repos/test-repo', branch: 'main' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo
      expect(body.id).toBe(1)
      expect(repoService.initLocalRepo).toHaveBeenCalledWith(mockDb, mockGitAuthService, 'repos/test-repo', 'main')
    })

    it('should clone a remote repo through cloneRepo', async () => {
      const repo = createMockRepo({ repoUrl: 'https://github.com/test/remote' })
      vi.mocked(repoService.cloneRepo).mockResolvedValue(repo)

      const app = createTestRoutes()
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/test/remote', directoryName: 'remote' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo
      expect(body.repoUrl).toBe('https://github.com/test/remote')
      expect(repoService.cloneRepo).toHaveBeenCalledWith(mockDb, mockGitAuthService, 'https://github.com/test/remote', {
        branch: undefined,
        directoryName: 'remote',
        useWorktree: undefined,
        skipSSHVerification: undefined,
        baseBranch: undefined,
      })
    })

    it('should return 500 when repo creation throws', async () => {
      vi.mocked(repoService.initLocalRepo).mockRejectedValue(new Error('init failed'))

      const app = createTestRoutes()
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localPath: 'repos/test-repo' }),
      })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('init failed')
    })
  })

  describe('POST /:id/workspaces', () => {
    it('creates the workspace and returns the worktree setup result', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/repos/test-repo' }))

      const app = createTestRoutes()
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ directory: '/tmp/wrk-test', worktreeSetup: { status: 'none' } })
    })

    it('passes a requested worktree name to OpenCode', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/repos/test-repo' }))
      const client = createStubOpenCodeClient()
      const create = vi.fn(async () => ({ directory: '/tmp/feature-login' }))
      client.api.worktree.create = create as never

      const res = await createTestRoutes(client).request('/1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' feature-login ' }),
      })

      expect(res.status).toBe(200)
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'feature-login' }))
    })

    it('rejects a worktree name that is not a single folder name', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/repos/test-repo' }))
      const client = createStubOpenCodeClient()
      const create = vi.fn(async () => ({ directory: '/tmp/x' }))
      client.api.worktree.create = create as never

      const res = await createTestRoutes(client).request('/1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '../escape' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Directory name cannot contain dot-dot path segments' })
      expect(create).not.toHaveBeenCalled()
    })

    it('returns 200 with a failed worktree setup when the setup terminal cannot start', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/repos/test-repo' }))
      vi.mocked(db.getRepoSetting).mockImplementation((_database, _repoId, key) =>
        key === 'worktreeSetupCommands' ? JSON.stringify(['pnpm install']) : null,
      )
      vi.mocked(mockTerminalService.create).mockRejectedValueOnce(new Error('spawn failed'))

      const app = createTestRoutes()
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        directory: '/tmp/wrk-test',
        worktreeSetup: { status: 'failed', error: 'spawn failed' },
      })
    })

    it('runs the main project setup when a linked worktree row creates a workspace', async () => {
      const worktreeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-workspace-'))
      const repoFile = { version: 1 as const, setupWorktree: ['pnpm repo-setup'] }
      fs.mkdirSync(path.join(worktreeDirectory, '.ocm'), { recursive: true })
      fs.writeFileSync(path.join(worktreeDirectory, '.ocm', 'project.json'), JSON.stringify(repoFile))
      const hash = new ProjectConfigService(mockDb, {} as never, mockGitAuthService).hashRepoFile(repoFile)

      vi.mocked(db.getRepoById).mockReturnValue(
        createMockRepo({ id: 2, fullPath: '/tmp/repos/worktree', isWorktree: true }),
      )
      vi.mocked(db.getRepoSetting).mockImplementation((_database, repoId, key) => {
        if (repoId !== 1) return null
        if (key === 'worktreeSetupCommands') return JSON.stringify(['pnpm install'])
        if (key === 'repoConfigTrustHash') return hash
        return null
      })
      const mainRepo = createMockRepo({ id: 1, fullPath: '/tmp/repos/main' })
      const resolveSpy = vi
        .spyOn(ProjectConfigService.prototype, 'resolveProjectRepo')
        .mockResolvedValue(mainRepo)
      const client = createStubOpenCodeClient()
      client.api.worktree.create = vi.fn(async () => ({ directory: worktreeDirectory })) as never
      vi.mocked(mockTerminalService.create).mockResolvedValue({
        id: 'pty-setup',
        title: 'Worktree setup',
        kind: 'setup',
        cwd: worktreeDirectory,
        status: 'running',
      })

      try {
        const app = createTestRoutes(client)
        const res = await app.request('/2/workspaces', { method: 'POST' })

        expect(res.status).toBe(200)
        const body = (await res.json()) as { worktreeSetup: { status: string; repoCommandsSkipped: boolean } }
        expect(body.worktreeSetup).toMatchObject({ status: 'started', repoCommandsSkipped: false })
        expect(vi.mocked(mockTerminalService.create)).toHaveBeenCalledWith(worktreeDirectory, {
          kind: 'setup',
          name: 'Worktree setup',
          command: '/bin/sh',
          args: ['-c', 'set -e\npnpm install\npnpm repo-setup'],
          env: { ROOT_PROJECT_PATH: '/tmp/repos/main' },
        })
      } finally {
        resolveSpy.mockRestore()
        fs.rmSync(worktreeDirectory, { recursive: true, force: true })
      }
    })

    it('returns 200 with a failed setup when resolving the main project fails', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(
        createMockRepo({ id: 2, fullPath: '/tmp/repos/worktree', isWorktree: true }),
      )
      const resolveSpy = vi
        .spyOn(ProjectConfigService.prototype, 'resolveProjectRepo')
        .mockRejectedValue(new Error('git unavailable'))

      try {
        const app = createTestRoutes()
        const res = await app.request('/2/workspaces', { method: 'POST' })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
          directory: '/tmp/wrk-test',
          worktreeSetup: { status: 'failed', error: 'git unavailable' },
        })
      } finally {
        resolveSpy.mockRestore()
      }
    })
  })

  describe('POST /discover', () => {    it('should return 400 for an invalid body', async () => {
      const app = createTestRoutes()
      const res = await app.request('/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: '' }),
      })

      expect(res.status).toBe(400)
      expect(repoService.discoverLocalRepos).not.toHaveBeenCalled()
    })

    it('should return the discovered repos', async () => {
      const discovery = { repos: [createMockRepo()], discoveredCount: 1, existingCount: 0, errors: [] }
      vi.mocked(repoService.discoverLocalRepos).mockResolvedValue(discovery)

      const app = createTestRoutes()
      const res = await app.request('/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: '/tmp/repos', maxDepth: 2 }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as typeof discovery
      expect(body.discoveredCount).toBe(1)
      expect(repoService.discoverLocalRepos).toHaveBeenCalledWith(mockDb, mockGitAuthService, '/tmp/repos', 2)
    })

    it('should return 500 when discovery throws', async () => {
      vi.mocked(repoService.discoverLocalRepos).mockRejectedValue(new Error('discover failed'))

      const app = createTestRoutes()
      const res = await app.request('/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: '/tmp/repos' }),
      })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('discover failed')
    })
  })

  describe('GET /', () => {
    it('should return repos with current branch and git credential id, skipping the assistant repo', async () => {
      const repo = createMockRepo({ id: 1 })
      const assistantRepo = createMockRepo({ id: 0, localPath: 'assistant', fullPath: '/tmp/repos/assistant' })
      vi.mocked(db.listRepos).mockReturnValue([repo, assistantRepo])
      vi.mocked(repoService.getCurrentBranch).mockResolvedValue('main')
      vi.mocked(db.getRepoGitCredentialId).mockReturnValue('cred-1')

      const app = createTestRoutes()
      const res = await app.request('/', { method: 'GET' })

      expect(res.status).toBe(200)
      const body = await res.json() as Array<Repo & { currentBranch?: string }>
      expect(body).toHaveLength(2)
      expect(body[0]?.currentBranch).toBe('main')
      expect(body[0]?.gitCredentialId).toBe('cred-1')
      expect(body[1]?.currentBranch).toBeUndefined()
      expect(repoService.getCurrentBranch).toHaveBeenCalledTimes(1)
      expect(repoService.getCurrentBranch).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), {})
    })

    it('should return 500 when listing repos throws', async () => {
      vi.mocked(db.listRepos).mockImplementation(() => {
        throw new Error('list failed')
      })

      const app = createTestRoutes()
      const res = await app.request('/', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('list failed')
    })
  })

  describe('PUT /order', () => {
    it('should return 400 when order is not an array of numbers', async () => {
      const app = createTestRoutes()
      const res = await app.request('/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: ['a', 'b'] }),
      })

      expect(res.status).toBe(400)
      expect(mockUpdateSettings).not.toHaveBeenCalled()
    })

    it('should update the repo order', async () => {
      const app = createTestRoutes()
      const res = await app.request('/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [2, 1] }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(mockUpdateSettings).toHaveBeenCalledWith({ repoOrder: [2, 1] })
    })

    it('should return 500 when the body is not valid JSON', async () => {
      const app = createTestRoutes()
      const res = await app.request('/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })

      expect(res.status).toBe(500)
    })
  })

  describe('GET /:id', () => {
    it('should return the repo with its current branch', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 5 }))
      vi.mocked(repoService.getCurrentBranch).mockResolvedValue('develop')

      const app = createTestRoutes()
      const res = await app.request('/5', { method: 'GET' })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo & { currentBranch?: string }
      expect(body.id).toBe(5)
      expect(body.currentBranch).toBe('develop')
    })

    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/5', { method: 'GET' })

      expect(res.status).toBe(404)
    })

    it('should return 500 when reading the current branch throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 5 }))
      vi.mocked(repoService.getCurrentBranch).mockRejectedValue(new Error('branch failed'))

      const app = createTestRoutes()
      const res = await app.request('/5', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('branch failed')
    })
  })

  describe('PATCH /:id/git-credential', () => {
    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/git-credential', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })

      expect(res.status).toBe(404)
    })

    it('should return 400 when the credential is not in settings', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      mockGetSettings.mockReturnValue({ preferences: { repoOrder: [], gitCredentials: [] }, updatedAt: Date.now() })

      const app = createTestRoutes()
      const res = await app.request('/1/git-credential', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })

      expect(res.status).toBe(400)
      expect(db.setRepoGitCredentialId).not.toHaveBeenCalled()
    })

    it('should set the credential and return the updated repo', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      mockGetSettings.mockReturnValue({
        preferences: { repoOrder: [], gitCredentials: [{ id: 'cred-1', name: 'test', host: 'github.com' }] },
        updatedAt: Date.now(),
      })
      vi.mocked(db.getRepoGitCredentialId).mockReturnValue('cred-1')

      const app = createTestRoutes()
      const res = await app.request('/1/git-credential', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo
      expect(body.gitCredentialId).toBe('cred-1')
      expect(db.setRepoGitCredentialId).toHaveBeenCalledWith(mockDb, 1, 'cred-1')
    })

    it('should clear the credential when none is provided', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(db.getRepoGitCredentialId).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/git-credential', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: '' }),
      })

      expect(res.status).toBe(200)
      expect(db.setRepoGitCredentialId).toHaveBeenCalledWith(mockDb, 1, null)
    })

    it('should return 500 when reading the repo throws', async () => {
      vi.mocked(db.getRepoById).mockImplementation(() => {
        throw new Error('repo failed')
      })

      const app = createTestRoutes()
      const res = await app.request('/1/git-credential', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })

      expect(res.status).toBe(500)
    })
  })

  describe('DELETE /:id', () => {
    it('should return 403 for the assistant repo id', async () => {
      const app = createTestRoutes()
      const res = await app.request('/0', { method: 'DELETE' })

      expect(res.status).toBe(403)
    })

    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })

    it('should prepare the delete and remove the repo files', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.deleteRepoFiles).mockResolvedValue(undefined)

      const app = createTestRoutes()
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(mockPrepareRepoDelete).toHaveBeenCalledWith(1)
      expect(mockTerminalService.removeAll).toHaveBeenCalledWith('/tmp/repos/test-repo')
      expect(repoService.deleteRepoFiles).toHaveBeenCalledWith(mockDb, 1)
    })

    it('should still delete the repo when terminal cleanup throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.deleteRepoFiles).mockResolvedValue(undefined)
      vi.mocked(mockTerminalService.removeAll).mockRejectedValueOnce(new Error('pty cleanup failed'))

      const app = createTestRoutes()
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(repoService.deleteRepoFiles).toHaveBeenCalledWith(mockDb, 1)
    })

    it('removes terminals for OpenCode workspace siblings but not manager worktree repos', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/repos/test-repo' }))
      vi.mocked(repoService.deleteRepoFiles).mockResolvedValue(undefined)
      vi.mocked(repoService.listRepoSiblings).mockImplementation(async (_database, _repoId, _gitEnv, _client, filter) => {
        const siblings = [
          { ...createMockRepo({ id: 2, fullPath: '/tmp/repos/manager-worktree', isWorktree: true }), currentBranch: undefined },
          { ...createMockRepo({ id: -1, fullPath: '/tmp/plugin-workspace' }), currentBranch: undefined, worktreeSource: 'opencode' as const },
        ]
        return filter ? siblings.filter(filter) : siblings
      })

      const app = createTestRoutes()
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(mockTerminalService.removeAll).toHaveBeenCalledWith('/tmp/repos/test-repo')
      expect(mockTerminalService.removeAll).toHaveBeenCalledWith('/tmp/plugin-workspace')
      expect(mockTerminalService.removeAll).not.toHaveBeenCalledWith('/tmp/repos/manager-worktree')
      expect(repoService.listRepoSiblings).toHaveBeenCalledWith(mockDb, 1, {}, expect.anything(), expect.any(Function))
      expect(repoService.deleteRepoFiles).toHaveBeenCalledWith(mockDb, 1)
    })

    it('still deletes the repo when listing workspace siblings throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.deleteRepoFiles).mockResolvedValue(undefined)
      vi.mocked(repoService.listRepoSiblings).mockRejectedValue(new Error('siblings failed'))

      const app = createTestRoutes()
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(repoService.deleteRepoFiles).toHaveBeenCalledWith(mockDb, 1)
    })

    it('should return 500 when removing the repo files throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.deleteRepoFiles).mockRejectedValue(new Error('delete failed'))

      const app = createTestRoutes()
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('delete failed')
    })
  })

  describe('POST /:id/pull', () => {
    it('should pull the repo and return the refreshed repo', async () => {
      const repo = createMockRepo({ id: 3 })
      vi.mocked(repoService.pullRepo).mockResolvedValue(undefined)
      vi.mocked(db.getRepoById).mockReturnValue(repo)

      const app = createTestRoutes()
      const res = await app.request('/3/pull', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo
      expect(body.id).toBe(3)
      expect(repoService.pullRepo).toHaveBeenCalledWith(mockDb, mockGitAuthService, 3)
    })

    it('should return 500 when pulling throws', async () => {
      vi.mocked(repoService.pullRepo).mockRejectedValue(new Error('pull failed'))

      const app = createTestRoutes()
      const res = await app.request('/3/pull', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('pull failed')
    })
  })

  describe('POST /:id/branch/switch', () => {
    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/branch/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(404)
    })

    it('should return 400 when the branch is missing', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))

      const app = createTestRoutes()
      const res = await app.request('/1/branch/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    it('should switch the branch and return the current branch', async () => {
      const repo = createMockRepo({ id: 1 })
      vi.mocked(db.getRepoById).mockReturnValue(repo)
      vi.mocked(repoService.switchBranch).mockResolvedValue(undefined)
      vi.mocked(repoService.getCurrentBranch).mockResolvedValue('feature')

      const app = createTestRoutes()
      const res = await app.request('/1/branch/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo & { currentBranch?: string }
      expect(body.currentBranch).toBe('feature')
      expect(repoService.switchBranch).toHaveBeenCalledWith(mockDb, mockGitAuthService, 1, 'feature')
    })

    it('should return 500 when switching the branch throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.switchBranch).mockRejectedValue(new Error('switch failed'))

      const app = createTestRoutes()
      const res = await app.request('/1/branch/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('switch failed')
    })
  })

  describe('POST /:id/branch/create', () => {
    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/branch/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(404)
    })

    it('should return 400 when the branch is missing', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))

      const app = createTestRoutes()
      const res = await app.request('/1/branch/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    it('should create the branch and return the current branch', async () => {
      const repo = createMockRepo({ id: 1 })
      vi.mocked(db.getRepoById).mockReturnValue(repo)
      vi.mocked(repoService.createBranch).mockResolvedValue(undefined)
      vi.mocked(repoService.getCurrentBranch).mockResolvedValue('feature')

      const app = createTestRoutes()
      const res = await app.request('/1/branch/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo & { currentBranch?: string }
      expect(body.currentBranch).toBe('feature')
      expect(repoService.createBranch).toHaveBeenCalledWith(mockDb, mockGitAuthService, 1, 'feature')
    })

    it('should return 500 when creating the branch throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.createBranch).mockRejectedValue(new Error('create failed'))

      const app = createTestRoutes()
      const res = await app.request('/1/branch/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('create failed')
    })
  })

  describe('GET /:id/download', () => {
    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createTestRoutes()
      const res = await app.request('/1/download', { method: 'GET' })

      expect(res.status).toBe(404)
    })

    it('should stream the archive with the requested options', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/repos/test-repo' }))
      vi.mocked(archiveService.createRepoArchive).mockResolvedValue('/tmp/repo-archive.zip')
      vi.mocked(archiveService.getArchiveSize).mockResolvedValue(3)
      vi.mocked(archiveService.getArchiveStream).mockReturnValue(
        Readable.from(['zip']) as unknown as ReturnType<typeof archiveService.getArchiveStream>,
      )
      vi.mocked(archiveService.deleteArchive).mockResolvedValue(undefined)

      const app = createTestRoutes()
      const res = await app.request('/1/download?includeGit=true&includePaths=src,docs', { method: 'GET' })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/zip')
      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="test-repo.zip"')
      expect(res.headers.get('Content-Length')).toBe('3')
      expect(archiveService.createRepoArchive).toHaveBeenCalledWith('/tmp/repos/test-repo', {
        includeGit: true,
        includePaths: ['src', 'docs'],
      })

      const body = await res.text()
      expect(body).toBe('zip')
      await vi.waitFor(() => {
        expect(archiveService.deleteArchive).toHaveBeenCalledWith('/tmp/repo-archive.zip')
      })
    })

    it('should return 500 when archive creation throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(archiveService.createRepoArchive).mockRejectedValue(new Error('archive failed'))

      const app = createTestRoutes()
      const res = await app.request('/1/download', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('archive failed')
    })
  })

  describe('POST /:id/reset-permissions upstream failure', () => {
    it('should return 502 when the OpenCode API call fails', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/test-repo' }))
      const locationGet = vi.fn(async () => {
        throw new ClientError('Transport')
      })

      const app = createTestRoutes(createStubOpenCodeClient({
        api: { location: { get: locationGet } } as unknown as OpenCodeApi,
      }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'Failed to reset permissions', code: 'ClientError' })
    })

    it('should return 500 when listing saved permissions throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, fullPath: '/tmp/test-repo' }))
      const locationGet = vi.fn(async () => ({
        directory: '/tmp/test-repo',
        project: { id: 'project-A', directory: '/tmp/test-repo', canonical: '/tmp/test-repo' },
      }))
      const savedList = vi.fn(async () => {
        throw new Error('list failed')
      })

      const app = createTestRoutes(createStubOpenCodeClient({
        api: {
          location: { get: locationGet },
          permission: { saved: { list: savedList, remove: vi.fn() } },
        } as unknown as OpenCodeApi,
      }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Failed to reset permissions')
    })
  })

  describe('assistant repo id 0', () => {
    const assistantRepo = createMockRepo({ id: 0, localPath: 'assistant', fullPath: '/tmp/repos/assistant' })

    it('should return assistant mode status for the assistant repo on GET', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)
      vi.mocked(buildAssistantRepo).mockReturnValue(assistantRepo)
      const status: AssistantModeStatus = {
        repoId: 0,
        directory: '/tmp/repos/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '/tmp/repos/assistant/AGENTS.md', exists: true, created: false },
          opencodeJson: { path: '/tmp/repos/assistant/opencode.json', exists: true, created: false },
        },
      }
      vi.mocked(getAssistantModeStatus).mockResolvedValue(status)

      const app = createTestRoutes()
      const res = await app.request('/0/assistant-mode', { method: 'GET' })

      expect(res.status).toBe(200)
      const body = await res.json() as AssistantModeStatus
      expect(body.repoId).toBe(0)
      expect(getAssistantModeStatus).toHaveBeenCalledWith(assistantRepo)
    })

    it('should initialize assistant mode for the assistant repo on POST', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)
      vi.mocked(buildAssistantRepo).mockReturnValue(assistantRepo)
      const status: AssistantModeStatus = {
        repoId: 0,
        directory: '/tmp/repos/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '/tmp/repos/assistant/AGENTS.md', exists: true, created: true },
          opencodeJson: { path: '/tmp/repos/assistant/opencode.json', exists: true, created: true },
        },
      }
      vi.mocked(ensureAssistantMode).mockResolvedValue(status)

      const app = createTestRoutes()
      const res = await app.request('/0/assistant-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteAgentsMd: true }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as AssistantModeStatus
      expect(body.repoId).toBe(0)
      expect(ensureAssistantMode).toHaveBeenCalledWith(assistantRepo, { overwriteAgentsMd: true })
    })

    it('should return 500 when the assistant mode status throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)
      vi.mocked(buildAssistantRepo).mockReturnValue(assistantRepo)
      vi.mocked(getAssistantModeStatus).mockRejectedValue(new Error('assistant failed'))

      const app = createTestRoutes()
      const res = await app.request('/0/assistant-mode', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('assistant failed')
    })
  })
})
