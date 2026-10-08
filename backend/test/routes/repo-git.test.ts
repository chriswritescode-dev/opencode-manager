import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { GitAuthService } from '../../src/services/git-auth'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { createRepoGitRoutes } from '../../src/routes/repo-git'
import { stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { createGitService, GitService } from '../../src/services/git/GitService'
import * as db from '../../src/db/queries'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
  getRepoByDirectory: vi.fn(),
  updateRepoBranch: vi.fn(),
  listRepos: vi.fn(() => []),
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/repos'),
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace'),
  getOpenCodeGlobalConfigPath: vi.fn(() => '/tmp/test-workspace/.config/opencode'),
  ENV: {
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
    SERVER: { PORT: 5001, HOST: '0.0.0.0', CORS_ORIGIN: '*', NODE_ENV: 'test' },
    AUTH: { SECRET: 'test-secret' },
  },
}))

vi.mock('@opencode-manager/shared/config', () => ({
  DEFAULTS: {
    SSE: {
      RECONNECT_DELAY_MS: 1000,
      MAX_RECONNECT_DELAY_MS: 30000,
      IDLE_GRACE_PERIOD_MS: 120000,
    },
  },
}))

vi.mock('eventsource', () => ({
  EventSource: vi.fn(),
}))

const getRepoByIdMock = db.getRepoById as MockedFunction<typeof db.getRepoById>

describe('Repo Git Routes', () => {
  let app: Hono
  let mockDatabase: Database
  let mockGitAuthService: GitAuthService
  let mockOpenCodeClient: OpenCodeClient
  let generateTextMock: MockedFunction<(input: { prompt: string }) => Promise<{ text: string }>>

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = {
      run: vi.fn(),
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
        iterate: vi.fn(),
        values: vi.fn(),
      })),
      exec: vi.fn(),
      query: vi.fn(() => ({
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        run: vi.fn(),
      })),
      inTransaction: vi.fn(),
      transaction: vi.fn((fn: () => void) => fn),
      close: vi.fn(),
    } as unknown as Database
    mockGitAuthService = {
      getGitEnvironment: vi.fn().mockReturnValue({}),
    } as unknown as GitAuthService
    generateTextMock = vi.fn()
    mockOpenCodeClient = {
      api: { ...stubLoadedModelCatalog(), generate: { text: generateTextMock } },
    } as unknown as OpenCodeClient
    app = createRepoGitRoutes(
      mockDatabase,
      createGitService(mockGitAuthService),
      mockOpenCodeClient,
      { commitMessageTimeoutMs: 50 },
    )
  })

  describe('POST /git-status-batch', () => {
    it('returns 400 when repoIds is not an array', async () => {
      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds: 'not-an-array' }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'repoIds must be an array of numbers')
    })

    it('returns 400 when repoIds contains non-numbers', async () => {
      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds: [1, 'two', 3] }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'repoIds must be an array of numbers')
    })

    it('returns empty object when no repos found', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds: [1, 2, 3] }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({})
    })

    it('returns status for multiple repos', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockImplementation((_, id) => {
        if (id === 1) return { id: 1, fullPath: '/repo1' } as any
        if (id === 2) return { id: 2, fullPath: '/repo2' } as any
        return null
      })

      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds: [1, 2] }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('1')
      expect(body).toHaveProperty('2')
    })

    it('skips repos that fail and continues with others', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockImplementation((_, id) => {
        if (id === 1) return { id: 1, fullPath: '/repo1' } as any
        if (id === 2) return null
        return null
      })

      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const response = await app.request('/git-status-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds: [1, 2] }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('1')
      expect(body).not.toHaveProperty('2')
    })
  })

  describe('GET /:id/git/diff-full', () => {
    it('returns 400 when path parameter is missing', async () => {
      const response = await app.request('/1/git/diff-full')
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'path query parameter is required')
    })

    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/diff-full?path=file.ts')
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('returns diff with includeStaged=true', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/repos/test-repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve('+added line')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/diff-full?path=file.ts&includeStaged=true')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('path')
      expect(body).toHaveProperty('diff')
      expect(body).toHaveProperty('additions')
      expect(body).toHaveProperty('deletions')
    })

    it('returns diff with includeStaged=false', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/repos/test-repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve('-removed line')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/diff-full?path=file.ts&includeStaged=false')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('deletions')
    })

    it('returns 500 when diff operation fails', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, localPath: 'test-repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.reject(new Error('Diff failed'))
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/diff-full?path=file.ts')
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('GET /:id/git/branches', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/branches')
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('returns branches and status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123 [origin/main] Initial commit')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/branches')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('branches')
      expect(body).toHaveProperty('status')
      expect(Array.isArray((body as { branches: unknown[] }).branches)).toBe(true)
    })

    it('returns 500 when branch operation fails', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockRejectedValue(new Error('Git operation failed'))

      const response = await app.request('/1/git/branches')
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/discard', () => {
    it('should return 404 when repo does not exist', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue(null)
      const response = await app.request('/999/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when paths is not an array', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1 } as any)
      const response = await app.request('/1/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: 'not-an-array' }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'paths is required and must be an array')
    })

    it('should return 400 when paths is missing', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1 } as any)
      const response = await app.request('/1/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'paths is required and must be an array')
    })

    it('should return 500 when git operation fails', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts'], staged: false }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/commit-message', () => {
    afterEach(async () => {
      const { executeCommand } = await import('../../src/utils/process')
      ;(executeCommand as MockedFunction<typeof executeCommand>).mockReset()
    })

    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/commit-message', { method: 'POST' })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 400 when there are no staged changes', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockResolvedValue('')

      const response = await app.request('/1/git/commit-message', { method: 'POST' })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error', 'No staged changes')
      expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('returns the normalized message on success', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('--stat')) return Promise.resolve(' src/index.ts | 2 +-')
        if (args.includes('log')) return Promise.resolve('feat: prior change')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        return Promise.resolve('+added line')
      })
      generateTextMock.mockResolvedValue({ text: '```\nfeat: add thing\n```' })

      const response = await app.request('/1/git/commit-message', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ message: 'feat: add thing' })
      expect(generateTextMock).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: expect.stringContaining('src/index.ts | 2 +-') }),
        expect.objectContaining({ signal: expect.anything() }),
      )
    })

    it('returns 502 when the model returns an empty message', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('--stat')) return Promise.resolve(' src/index.ts | 2 +-')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        return Promise.resolve('+added line')
      })
      generateTextMock.mockResolvedValue({ text: '   ' })

      const response = await app.request('/1/git/commit-message', { method: 'POST' })

      expect(response.status).toBe(502)
      expect(await response.json()).toHaveProperty('error', 'Model returned an empty commit message')
    })

    it('returns 502 when the model returns a labeled empty fence', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('--stat')) return Promise.resolve(' src/index.ts | 2 +-')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        return Promise.resolve('+added line')
      })
      generateTextMock.mockResolvedValue({ text: 'Commit message:\n```\n```' })

      const response = await app.request('/1/git/commit-message', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(502)
      expect(body).toHaveProperty('error', 'Model returned an empty commit message')
      expect(body).not.toHaveProperty('message')
    })

    it('returns 502 when the client throws', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('--stat')) return Promise.resolve(' src/index.ts | 2 +-')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        return Promise.resolve('+added line')
      })
      generateTextMock.mockRejectedValue(new Error('Model unavailable'))

      const response = await app.request('/1/git/commit-message', { method: 'POST' })

      expect(response.status).toBe(502)
      expect(await response.json()).toHaveProperty('error', 'Model unavailable')
    })

    it('returns 502 when generation times out', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('--stat')) return Promise.resolve(' src/index.ts | 2 +-')
        if (args.includes('log')) return Promise.resolve('feat: prior change')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        return Promise.resolve('+added line')
      })
      generateTextMock.mockImplementation(() => new Promise<never>(() => {}))

      const response = await app.request('/1/git/commit-message', { method: 'POST' })

      expect(response.status).toBe(502)
      expect(await response.json()).toHaveProperty('error', 'Commit message generation timed out')
    })
  })

  describe('GET /:id/git/commit/:hash', () => {
    it('should return 404 when repo does not exist', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue(null)
      const response = await app.request('/999/git/commit/abc123')

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when hash is missing', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1 } as any)
      const response = await app.request('/1/git/commit/')

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should return 500 when git operation fails', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/commit/abc123')

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toHaveProperty('error')
    })
  })

  describe('GET /:id/git/commit/:hash/diff', () => {
    it('should return 404 when repo does not exist', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue(null)
      const response = await app.request('/999/git/commit/abc123/diff?path=file.ts')

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when hash is missing', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1 } as any)
      const response = await app.request('/1/git/commit//diff?path=file.ts')

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should return 400 when path query parameter is missing', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1 } as any)
      const response = await app.request('/1/git/commit/abc123/diff')
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'path query parameter is required')
    })

    it('should return 500 when git operation fails', async () => {
      ;(db.getRepoById as MockedFunction<typeof db.getRepoById>).mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/commit/abc123/diff?path=file.ts')

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/branches/rename', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/branches/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'main', to: 'renamed' }),
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 400 when the request body is invalid', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/branches/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'main' }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })

    it('renames the branch and returns the refreshed status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo', branch: 'main' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('renamed')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/branches/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'main', to: 'renamed' }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('branch', 'renamed')
      expect(body).toHaveProperty('files')
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'branch', '-m', '--', 'main', 'renamed'],
        { env: expect.any(Object) }
      )
    })

    it('returns 400 for an option-like source branch name', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo', branch: 'main' } as any)
      const response = await app.request('/1/git/branches/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '--force', to: 'victim' }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })

    it('returns 409 when the branch is checked out in another worktree', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo', branch: 'main' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('worktree')) {
          return Promise.resolve('worktree /path/to/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /other\nHEAD def\nbranch refs/heads/feature\n')
        }
        if (args.includes('rev-parse')) return Promise.resolve('main')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/branches/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'feature', to: 'feature-renamed' }),
      })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toHaveProperty('code', 'BRANCH_IN_OTHER_WORKTREE')
    })
  })

  describe('DELETE /:id/git/branches', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/branches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'feature' }),
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 400 when the request body is invalid', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/branches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })

    it('deletes the branch and returns remoteDeleted with the refreshed status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo', branch: 'main' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/branches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'feature', force: false, deleteRemote: false }),
      })
      const body = await response.json() as { remoteDeleted: boolean; status: { branch: string } }

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('remoteDeleted', false)
      expect(body).toHaveProperty('status')
      expect(body.status).toHaveProperty('branch', 'main')
    })

    it('returns 409 when deleting the checked-out branch', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo', branch: 'main' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/branches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'main', force: true, deleteRemote: false }),
      })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toHaveProperty('code', 'BRANCH_CHECKED_OUT')
    })

    it('returns 400 for an option-like branch name', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo', branch: 'main' } as any)
      const response = await app.request('/1/git/branches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '--force', force: true }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/integrate', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/integrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBranch: 'main' }),
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 400 when the request body is invalid', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/integrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: 'merge' }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })

    it('returns 409 with the conflict body shape when the merge stops on conflicts', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>
      const getRepoByDirectoryMock = db.getRepoByDirectory as MockedFunction<typeof db.getRepoByDirectory>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/source', branch: 'feature' } as any)
      getRepoByDirectoryMock.mockReturnValue({ id: 2, fullPath: '/target', branch: 'main' } as any)

      let mergeAttempted = false
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('worktree')) {
          return Promise.resolve('worktree /source\nHEAD aaa\nbranch refs/heads/feature\n\nworktree /target\nHEAD bbb\nbranch refs/heads/main\n')
        }
        if (args.includes('--git-path')) {
          return Promise.resolve([
            '/nonexistent/rebase-merge',
            '/nonexistent/rebase-apply',
            mergeAttempted ? process.cwd() : '/nonexistent/MERGE_HEAD',
            '/nonexistent/CHERRY_PICK_HEAD',
            '/nonexistent/REVERT_HEAD',
          ].join('\n'))
        }
        if (args.includes('symbolic-ref')) return Promise.resolve('refs/heads/feature')
        if (args.includes('rev-parse')) return Promise.resolve('feature')
        if (args.includes('status')) return Promise.resolve('')
        if (args.includes('rev-list')) return Promise.resolve('1')
        if (args.includes('merge')) {
          mergeAttempted = true
          return Promise.reject(new Error('Command failed with code 1: CONFLICT (content): Merge conflict in file.txt'))
        }
        if (args.includes('diff')) return Promise.resolve('file.txt')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/integrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBranch: 'main', strategy: 'merge' }),
      })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toEqual({
        error: 'Merge conflict detected. Resolve the conflicts before continuing.',
        detail: 'Integration stopped on conflicts',
        code: 'MERGE_CONFLICT',
        details: { targetRepoId: 2, operation: { kind: 'merge', conflictedFiles: ['file.txt'] } },
      })
    })

    it('returns the target status for the integrated repo', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo', branch: 'feature' } as any)
      const integrateSpy = vi.spyOn(GitService.prototype, 'integrateBranch').mockResolvedValue({
        targetRepoId: 2,
        integratedCommits: 3,
      })
      const statusSpy = vi.spyOn(GitService.prototype, 'getStatus').mockResolvedValue({
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [],
        hasChanges: false,
        operation: null,
      })

      try {
        const response = await app.request('/1/git/integrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetBranch: 'main', strategy: 'merge' }),
        })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body).toEqual({
          targetRepoId: 2,
          integratedCommits: 3,
          targetStatus: { branch: 'main', ahead: 0, behind: 0, files: [], hasChanges: false, operation: null },
        })
        expect(statusSpy).toHaveBeenCalledWith(2, mockDatabase)
      } finally {
        integrateSpy.mockRestore()
        statusSpy.mockRestore()
      }
    })
  })

  describe('GET /:id/git/stash', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/stash')

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns parsed stashes', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('stash') && args.includes('list')) {
          return Promise.resolve('stash@{0}\x1fabc123\x1fOn main: wip note\x1f2024-01-01T00:00:00+00:00')
        }
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/stash')
      const body = await response.json() as { stashes: Array<Record<string, unknown>> }

      expect(response.status).toBe(200)
      expect(body.stashes).toHaveLength(1)
      expect(body.stashes[0]).toMatchObject({ index: 0, ref: 'stash@{0}', hash: 'abc123', message: 'wip note', branch: 'main' })
    })
  })

  describe('POST /:id/git/stash', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/stash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 400 when the request body is invalid', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/stash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 123 }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })

    it('pushes a stash and returns the refreshed status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/stash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'wip note', includeUntracked: true }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('branch', 'main')
      expect(executeCommandMock).toHaveBeenCalledWith(
        expect.arrayContaining(['stash', 'push', '-u', '-m', 'wip note']),
        expect.any(Object)
      )
    })
  })

  describe('POST /:id/git/stash/:index/apply', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/stash/0/apply', { method: 'POST' })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 400 for a non-integer index', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/stash/abc/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pop: false }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error', 'index must be a non-negative integer')
    })

    it('returns 400 when the hash is missing', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/stash/2/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pop: true }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })

    it('applies the stash and returns the refreshed status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/stash/2/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: 'main', pop: true }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('branch', 'main')
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'stash', 'pop', 'stash@{2}'],
        expect.any(Object)
      )
    })

    it('returns 409 with STASH_CHANGED when the hash does not match', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/stash/0/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: 'stale', pop: false }),
      })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toHaveProperty('code', 'STASH_CHANGED')
      expect(executeCommandMock).not.toHaveBeenCalledWith(
        expect.arrayContaining(['stash', 'apply']),
        expect.any(Object)
      )
    })
  })

  describe('DELETE /:id/git/stash/:index', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/stash/0', { method: 'DELETE' })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 400 for a non-integer index', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/stash/1.5', { method: 'DELETE' })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error', 'index must be a non-negative integer')
    })

    it('returns 400 when the hash is missing', async () => {
      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      const response = await app.request('/1/git/stash/0', { method: 'DELETE' })

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
    })

    it('drops the stash and returns the refreshed status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/stash/0', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: 'main' }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('branch', 'main')
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'stash', 'drop', 'stash@{0}'],
        expect.any(Object)
      )
    })

    it('returns 409 with STASH_CHANGED when the hash does not match', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/stash/0', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: 'stale' }),
      })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toHaveProperty('code', 'STASH_CHANGED')
    })
  })

  describe('POST /:id/git/operation/continue', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/operation/continue', { method: 'POST' })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 409 when no operation is in progress', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockResolvedValue('')

      const response = await app.request('/1/git/operation/continue', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toHaveProperty('code', 'NO_OPERATION_IN_PROGRESS')
    })

    it('continues the operation and returns the refreshed status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('--git-path')) return Promise.resolve(process.cwd())
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/operation/continue', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('branch', 'main')
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'rebase', '--continue'],
        { env: expect.objectContaining({ GIT_EDITOR: 'true' }) }
      )
    })
  })

  describe('POST /:id/git/operation/abort', () => {
    it('returns 404 when repo does not exist', async () => {
      getRepoByIdMock.mockReturnValue(null)
      const response = await app.request('/999/git/operation/abort', { method: 'POST' })

      expect(response.status).toBe(404)
      expect(await response.json()).toHaveProperty('error', 'Repo not found')
    })

    it('returns 409 when no operation is in progress', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockResolvedValue('')

      const response = await app.request('/1/git/operation/abort', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toHaveProperty('code', 'NO_OPERATION_IN_PROGRESS')
    })

    it('aborts the operation and returns the refreshed status', async () => {
      const { executeCommand } = await import('../../src/utils/process')
      const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>

      getRepoByIdMock.mockReturnValue({ id: 1, fullPath: '/path/to/repo' } as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('--git-path')) return Promise.resolve(process.cwd())
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const response = await app.request('/1/git/operation/abort', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('branch', 'main')
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'rebase', '--abort'],
        expect.any(Object)
      )
    })
  })
})
