import { describe, it, expect, beforeEach, vi } from 'vitest'
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
import type { GitAuthService } from '../../src/services/git-auth'
import type { ScheduleService } from '../../src/services/schedules'
import type { AssistantModeStatus, Repo } from '@opencode-manager/shared/types'
import { getAssistantModeStatus, ensureAssistantMode, buildAssistantRepo } from '../../src/services/assistant-mode'

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({})
} as unknown as GitAuthService

const mockPrepareRepoDelete = vi.fn()
const mockScheduleService = {
  prepareRepoDelete: mockPrepareRepoDelete,
} as unknown as ScheduleService

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
  })

  describe('POST /:id/access', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Database error')
    })
  })

  describe('GET /:id/assistant-mode', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(404)
    })

    it('should return 400 without disposing when repo has no directory', async () => {
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

      const forward = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }))
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(400)
      expect(forward).not.toHaveBeenCalled()
    })

    it('should dispose only the repo directory and return success', async () => {
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
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)

      const forward = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }))
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(200)
      expect(forward).toHaveBeenCalledWith({
        method: 'POST',
        path: '/instance/dispose',
        directory: '/tmp/test-repo',
      })
    })
  })

  describe('POST /:id/workspaces', () => {
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
    }

    it('returns the workspace created outside the project roots even while sandboxing is enforced', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)
      vi.mocked(opencodeServerManager.isSandboxEnforced).mockReturnValue(true)

      const forward = vi.fn(async () =>
        new Response(
          JSON.stringify({ id: 'wrk_outside', directory: '/workspace/.opencode/state/workspaces/wrk_outside', branch: null }),
          { status: 200 },
        ),
      )
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { id: string }
      expect(body.id).toBe('wrk_outside')
      expect(forward).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE' }))
    })

    it('returns a workspace with an empty response body when sandboxing is enforced', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)
      vi.mocked(opencodeServerManager.isSandboxEnforced).mockReturnValue(true)

      const forward = vi.fn(async () => new Response('', { status: 200 }))
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(forward).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE' }))
    })

    it('allows workspace creation when sandboxing is not enforced', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)
      vi.mocked(opencodeServerManager.isSandboxEnforced).mockReturnValue(false)

      const forward = vi.fn(async () =>
        new Response(
          JSON.stringify({ id: 'wrk_ok', directory: '/workspace/.opencode/state/workspaces/wrk_ok', branch: null }),
          { status: 200 },
        ),
      )
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { id: string }
      expect(body.id).toBe('wrk_ok')
      expect(forward).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE' }))
    })
  })

  describe('POST /', () => {
    it('should return 400 when neither repoUrl nor localPath is provided', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

  describe('POST /discover', () => {
    it('should return 400 for an invalid body', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('list failed')
    })
  })

  describe('PUT /order', () => {
    it('should return 400 when order is not an array of numbers', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: ['a', 'b'] }),
      })

      expect(res.status).toBe(400)
      expect(mockUpdateSettings).not.toHaveBeenCalled()
    })

    it('should update the repo order', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/5', { method: 'GET' })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo & { currentBranch?: string }
      expect(body.id).toBe(5)
      expect(body.currentBranch).toBe('develop')
    })

    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/5', { method: 'GET' })

      expect(res.status).toBe(404)
    })

    it('should return 500 when reading the current branch throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 5 }))
      vi.mocked(repoService.getCurrentBranch).mockRejectedValue(new Error('branch failed'))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/5', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('branch failed')
    })
  })

  describe('GET /:id/siblings', () => {
    it('should return 400 for a non-numeric repo id', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/abc/siblings', { method: 'GET' })

      expect(res.status).toBe(400)
      expect(repoService.getSiblingRepos).not.toHaveBeenCalled()
    })

    it('should return the sibling repos', async () => {
      const siblings = [{ ...createMockRepo({ id: 2 }), currentBranch: 'main' }]
      vi.mocked(repoService.getSiblingRepos).mockResolvedValue(siblings)
      const client = createStubOpenCodeClient()

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, client)
      const res = await app.request('/1/siblings', { method: 'GET' })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo[]
      expect(body).toHaveLength(1)
      expect(repoService.getSiblingRepos).toHaveBeenCalledWith(mockDb, 1, {}, client)
    })

    it('should return 500 when listing siblings throws', async () => {
      vi.mocked(repoService.getSiblingRepos).mockRejectedValue(new Error('siblings failed'))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/siblings', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('siblings failed')
    })
  })

  describe('PATCH /:id/git-credential', () => {
    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/git-credential', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: 'cred-1' }),
      })

      expect(res.status).toBe(500)
    })
  })

  describe('PATCH /:id', () => {
    it('should return 400 for a non-numeric repo id', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      })

      expect(res.status).toBe(400)
    })

    it('should return 400 for the assistant repo id', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/0', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      })

      expect(res.status).toBe(400)
      expect(db.getRepoById).not.toHaveBeenCalled()
    })

    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      })

      expect(res.status).toBe(404)
    })

    it('should return 400 for an invalid body', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    it('should rename the repo and return the updated repo', async () => {
      vi.mocked(db.getRepoById)
        .mockReturnValueOnce(createMockRepo({ id: 1 }))
        .mockReturnValueOnce(createMockRepo({ id: 1, name: 'renamed' }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'renamed' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo
      expect(body.name).toBe('renamed')
      expect(db.updateRepoName).toHaveBeenCalledWith(mockDb, 1, 'renamed')
    })

    it('should clear the name when the trimmed value is empty', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      })

      expect(res.status).toBe(200)
      expect(db.updateRepoName).toHaveBeenCalledWith(mockDb, 1, null)
    })

    it('should return 500 when reading the repo throws', async () => {
      vi.mocked(db.getRepoById).mockImplementation(() => {
        throw new Error('repo failed')
      })

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      })

      expect(res.status).toBe(500)
    })
  })

  describe('DELETE /:id/workspaces/:workspaceId', () => {
    it('should return 400 for a non-numeric repo id', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/abc/workspaces/wrk_1', { method: 'DELETE' })

      expect(res.status).toBe(400)
    })

    it('should return 404 when the repo is missing or not ready', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const missingRes = await app.request('/1/workspaces/wrk_1', { method: 'DELETE' })
      expect(missingRes.status).toBe(404)

      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, cloneStatus: 'cloning' }))
      const notReadyRes = await app.request('/1/workspaces/wrk_1', { method: 'DELETE' })
      expect(notReadyRes.status).toBe(404)
    })

    it('should return 400 for an invalid workspace id', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/workspaces/bad-id', { method: 'DELETE' })

      expect(res.status).toBe(400)
    })

    it('should forward an upstream error status', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      const forward = vi.fn(async () => new Response('bad request', { status: 400 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces/wrk_1', { method: 'DELETE' })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('bad request')
      expect(forward).toHaveBeenCalledWith({
        method: 'DELETE',
        path: '/experimental/workspace/wrk_1',
        directory: '/tmp/repos/test-repo',
      })
    })

    it('should delete the workspace and return success', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      const forward = vi.fn(async () => new Response('', { status: 200 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces/wrk_1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('should return 500 when reading the repo throws', async () => {
      vi.mocked(db.getRepoById).mockImplementation(() => {
        throw new Error('repo failed')
      })

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/workspaces/wrk_1', { method: 'DELETE' })

      expect(res.status).toBe(500)
    })
  })

  describe('POST /:id/workspaces additional branches', () => {
    it('should return 400 for a non-numeric repo id', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/abc/workspaces', { method: 'POST' })

      expect(res.status).toBe(400)
    })

    it('should return 404 when the repo is missing or not ready', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const missingRes = await app.request('/1/workspaces', { method: 'POST' })
      expect(missingRes.status).toBe(404)

      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1, cloneStatus: 'cloning' }))
      const notReadyRes = await app.request('/1/workspaces', { method: 'POST' })
      expect(notReadyRes.status).toBe(404)
    })

    it('should forward an upstream error status', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      const forward = vi.fn(async () => new Response('boom', { status: 502 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(502)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('boom')
    })

    it('should return 500 when the upstream body is not JSON', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      const forward = vi.fn(async () => new Response('not-json', { status: 200 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Failed to create workspace')
    })

    it('should return the parsed workspace', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      const forward = vi.fn(async () =>
        new Response(JSON.stringify({ id: 'wrk_new', directory: '/tmp/wrk_new', branch: 'main' }), { status: 200 }),
      )

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/workspaces', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { id: string }
      expect(body.id).toBe('wrk_new')
    })
  })

  describe('DELETE /:id', () => {
    it('should return 403 for the assistant repo id', async () => {
      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/0', { method: 'DELETE' })

      expect(res.status).toBe(403)
    })

    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })

    it('should prepare the delete and remove the repo files', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.deleteRepoFiles).mockResolvedValue(undefined)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(mockPrepareRepoDelete).toHaveBeenCalledWith(1)
      expect(repoService.deleteRepoFiles).toHaveBeenCalledWith(mockDb, 1)
    })

    it('should return 500 when removing the repo files throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      vi.mocked(repoService.deleteRepoFiles).mockRejectedValue(new Error('delete failed'))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/3/pull', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as Repo
      expect(body.id).toBe(3)
      expect(repoService.pullRepo).toHaveBeenCalledWith(mockDb, mockGitAuthService, 3)
    })

    it('should return 500 when pulling throws', async () => {
      vi.mocked(repoService.pullRepo).mockRejectedValue(new Error('pull failed'))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/3/pull', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('pull failed')
    })
  })

  describe('POST /:id/branch/switch', () => {
    it('should return 404 when the repo does not exist', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/branch/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(404)
    })

    it('should return 400 when the branch is missing', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/branch/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: 'feature' }),
      })

      expect(res.status).toBe(404)
    })

    it('should return 400 when the branch is missing', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/1/download', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('archive failed')
    })
  })

  describe('POST /:id/reset-permissions upstream failure', () => {
    it('should return 500 when the upstream dispose fails', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      const forward = vi.fn(async () => new Response('nope', { status: 500 }))

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Failed to reset permissions')
    })

    it('should return 500 when forwarding throws', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(createMockRepo({ id: 1 }))
      const forward = vi.fn(async () => {
        throw new Error('forward failed')
      })

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient({ forward }))
      const res = await app.request('/1/reset-permissions', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('forward failed')
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
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

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
      const res = await app.request('/0/assistant-mode', { method: 'GET' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('assistant failed')
    })
  })
})
