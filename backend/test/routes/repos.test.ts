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
  getRepoGitCredentialId: vi.fn()
}))

vi.mock('../../src/services/repo', () => ({
  getCurrentBranch: vi.fn(),
  retryCloneRepo: vi.fn()
}))

vi.mock('../../src/services/assistant-mode', () => ({
  getAssistantModeStatus: vi.fn(),
  ensureAssistantMode: vi.fn(),
  getAssistantModeDirectory: vi.fn(),
  buildAssistantOpenCodeConfig: vi.fn(),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    clearStartupError: vi.fn(),
    restart: vi.fn().mockResolvedValue(undefined),
  },
}))

import * as db from '../../src/db/queries'
import { createRepoRoutes } from '../../src/routes/repos'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import type { GitAuthService } from '../../src/services/git-auth'
import type { ScheduleService } from '../../src/services/schedules'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'
import { getAssistantModeStatus, ensureAssistantMode } from '../../src/services/assistant-mode'
import { retryCloneRepo } from '../../src/services/repo'

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({})
} as unknown as GitAuthService

const mockScheduleService = {} as ScheduleService

describe('Repo Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        expect.objectContaining({ db: mockDb, apiBaseUrl: 'http://localhost:5003/api/internal' }),
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

describe('POST /:id/retry-clone', () => {
  function makeErrorRepo(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 7,
      repoUrl: 'https://github.com/acme/forge',
      localPath: 'forge',
      fullPath: '/tmp/repos/forge',
      branch: 'feature/x',
      defaultBranch: 'main',
      cloneStatus: 'error' as const,
      clonedAt: Date.now(),
      ...overrides,
    }
  }

  it('returns 404 when repo not found', async () => {
    vi.mocked(db.getRepoById).mockReturnValue(null)
    const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
    const res = await app.request('/7/retry-clone', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(retryCloneRepo).not.toHaveBeenCalled()
  })

  it('returns 400 when repo has no stored clone URL (local-only)', async () => {
    vi.mocked(db.getRepoById).mockReturnValue(makeErrorRepo({ repoUrl: undefined, isLocal: true }))
    const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
    const res = await app.request('/7/retry-clone', { method: 'POST' })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Only remote repositories can be retried')
    expect(retryCloneRepo).not.toHaveBeenCalled()
  })

  it('returns 409 when repo is not in a retryable state', async () => {
    vi.mocked(db.getRepoById).mockReturnValue(makeErrorRepo({ cloneStatus: 'ready' as const }))
    const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
    const res = await app.request('/7/retry-clone', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(retryCloneRepo).not.toHaveBeenCalled()
  })

  it('preserves the row id and stored config and returns the retried repo with settings', async () => {
    const repo = makeErrorRepo()
    vi.mocked(db.getRepoById).mockReturnValue(repo)
    const retried = { ...repo, cloneStatus: 'ready' as const, lastPulled: Date.now() }
    vi.mocked(retryCloneRepo).mockResolvedValue(retried)
    vi.mocked(db.getRepoGitCredentialId).mockReturnValue(null)

    const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
    const res = await app.request('/7/retry-clone', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(retryCloneRepo).toHaveBeenCalledWith(mockDb, mockGitAuthService, 7)
    const body = await res.json() as { id: number; cloneStatus: string; currentBranch: string | null }
    expect(body.id).toBe(7)
    expect(body.cloneStatus).toBe('ready')
  })

  it('propagates service failures as 500 without destroying the row', async () => {
    vi.mocked(db.getRepoById).mockReturnValue(makeErrorRepo())
    vi.mocked(retryCloneRepo).mockRejectedValue(new Error('Authentication failed'))
    const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService, createStubOpenCodeClient())
    const res = await app.request('/7/retry-clone', { method: 'POST' })
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Authentication failed')
  })
})
})
