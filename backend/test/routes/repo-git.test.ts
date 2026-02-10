import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { GitAuthService } from '../../src/services/git-auth'
import { createRepoGitRoutes } from '../../src/routes/repo-git'
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
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/repos'),
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace'),
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
      query: vi.fn(),
      inTransaction: vi.fn(),
      close: vi.fn(),
    } as unknown as Database
    mockGitAuthService = {
      getGitEnvironment: vi.fn().mockReturnValue({}),
    } as unknown as GitAuthService
    app = createRepoGitRoutes(mockDatabase, mockGitAuthService)
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
})
