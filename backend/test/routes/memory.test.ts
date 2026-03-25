import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({})),
}))

const mockListKv = vi.fn()

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../../src/services/project-id-resolver', () => ({
  resolveProjectId: vi.fn(),
}))

vi.mock('../../src/services/plugin-memory', () => ({
  PluginMemoryService: vi.fn().mockImplementation(() => ({
    listKv: mockListKv,
  })),
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
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

vi.mock('@opencode-manager/shared/utils', () => ({
  parseJsonc: vi.fn(),
}))

import { createMemoryRoutes } from '../../src/routes/memory'
import { resolveProjectId } from '../../src/services/project-id-resolver'
import { getRepoById } from '../../src/db/queries'

const mockResolveProjectId = resolveProjectId as ReturnType<typeof vi.fn>
const mockGetRepoById = getRepoById as ReturnType<typeof vi.fn>

describe('Memory Routes - Ralph Status', () => {
  let memoryApp: ReturnType<typeof createMemoryRoutes>
  let testDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveProjectId.mockReset()
    mockListKv.mockReset()
    mockGetRepoById.mockReset()

    testDb = {} as any
    memoryApp = createMemoryRoutes(testDb)
  })

  describe('GET /ralph/status', () => {
    it('should return 400 when repoId query param is missing', async () => {
      const req = new Request('http://localhost/ralph/status')
      const res = await memoryApp.fetch(req)

      expect(res.status).toBe(400)
      const json = await res.json() as Record<string, unknown>
      expect(json.error).toBe('Missing repoId')
    })

    it('should return 400 when repoId is not a valid number', async () => {
      const req = new Request('http://localhost/ralph/status?repoId=abc')
      const res = await memoryApp.fetch(req)

      expect(res.status).toBe(400)
      const json = await res.json() as Record<string, unknown>
      expect(json.error).toBe('Invalid repoId')
    })

    it('should return 200 with empty loops when repo is not found in DB', async () => {
      mockGetRepoById.mockReturnValue(null)

      const req = new Request('http://localhost/ralph/status?repoId=1')
      const res = await memoryApp.fetch(req)

      expect(res.status).toBe(200)
      const json = await res.json() as Record<string, unknown>
      expect(json.loops).toEqual([])
    })

    it('should return 200 with empty loops when resolveProjectId returns null', async () => {
      mockGetRepoById.mockReturnValue({
        id: 1,
        fullPath: '/tmp/test-repo',
        repoUrl: 'https://github.com/test/repo.git',
        localPath: 'test-repo',
        sourcePath: '',
        branch: 'main',
        currentBranch: 'main',
        cloneStatus: 'ready',
        isWorktree: false,
        openCodeConfigName: 'default',
      })
      mockResolveProjectId.mockResolvedValue(null)

      const req = new Request('http://localhost/ralph/status?repoId=1')
      const res = await memoryApp.fetch(req)

      expect(res.status).toBe(200)
      const json = await res.json() as Record<string, unknown>
      expect(json.loops).toEqual([])
    })

    it('should return 200 with loops array for a valid repo with active loops', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/tmp/test-repo',
        repoUrl: 'https://github.com/test/repo.git',
        localPath: 'test-repo',
        sourcePath: '',
        branch: 'main',
        currentBranch: 'main',
        cloneStatus: 'ready',
        isWorktree: false,
        openCodeConfigName: 'default',
      }
      mockGetRepoById.mockReturnValue(mockRepo)
      mockResolveProjectId.mockResolvedValue('test-project-id')
      mockListKv.mockReturnValue([
        {
          key: 'ralph:test-worktree',
          data: {
            active: true,
            sessionId: 'session-123',
            worktreeName: 'test-worktree',
            worktreeDir: '/tmp/worktrees/test',
            iteration: 1,
            maxIterations: 10,
            startedAt: '2024-01-01T00:00:00.000Z',
            prompt: 'Test prompt',
            phase: 'coding',
            audit: false,
            errorCount: 0,
            auditCount: 0,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 86400000,
        },
      ])

      const req = new Request('http://localhost/ralph/status?repoId=1')
      const res = await memoryApp.fetch(req)

      expect(res.status).toBe(200)
      const json = await res.json() as Record<string, unknown>
      expect(json.loops).toHaveLength(1)
      expect((json.loops as Array<Record<string, unknown>>)[0]?.active).toBe(true)
    })

    it('should filter out KV entries that do not have an active field', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/tmp/test-repo',
        repoUrl: 'https://github.com/test/repo.git',
        localPath: 'test-repo',
        sourcePath: '',
        branch: 'main',
        currentBranch: 'main',
        cloneStatus: 'ready',
        isWorktree: false,
        openCodeConfigName: 'default',
      }
      mockGetRepoById.mockReturnValue(mockRepo)
      mockResolveProjectId.mockResolvedValue('test-project-id')
      mockListKv.mockReturnValue([
        {
          key: 'ralph:test-worktree-1',
          data: {
            active: true,
            sessionId: 'session-123',
            worktreeName: 'test-worktree-1',
            worktreeDir: '/tmp/test-worktree-1',
            iteration: 1,
            maxIterations: 10,
            startedAt: new Date().toISOString(),
            phase: 'coding',
            errorCount: 0,
            auditCount: 0,
            completionPromise: null,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 86400000,
        },
        {
          key: 'ralph:test-worktree-2',
          data: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 86400000,
        },
        {
          key: 'ralph:test-worktree-3',
          data: 'string-data',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 86400000,
        },
        {
          key: 'ralph:test-worktree-4',
          data: { sessionId: 'session-abc' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 86400000,
        },
      ])

      const req = new Request('http://localhost/ralph/status?repoId=1')
      const res = await memoryApp.fetch(req)

      expect(res.status).toBe(200)
      const json = await res.json() as Record<string, unknown>
      expect(json.loops).toHaveLength(1)
      expect((json.loops as Array<Record<string, unknown>>)[0]?.active).toBe(true)
    })

    it('should return 500 when an unexpected error is thrown', async () => {
      mockGetRepoById.mockImplementation(() => {
        throw new Error('Database error')
      })

      const req = new Request('http://localhost/ralph/status?repoId=1')
      const res = await memoryApp.fetch(req)

      expect(res.status).toBe(500)
      const json = await res.json() as Record<string, unknown>
      expect(json.error).toBe('Failed to get Ralph status')
    })
  })
})
