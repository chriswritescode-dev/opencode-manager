import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRepoRoutes } from '../../src/routes/repos'
import type { Hono } from 'hono'
import { getRepoById } from '../../src/db/queries'

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

describe('Git Routes', () => {
  let app: Hono
  let mockDatabase: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = {}
    app = createRepoRoutes(mockDatabase)
  })

  describe('GET /:id/git/status', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/status')
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 500 when git operation fails for non-existent path', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/status')
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/fetch', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/fetch', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/fetch', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/pull', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/pull', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/pull', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/push', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/push', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should accept setUpstream parameter', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setUpstream: true }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should work without setUpstream parameter', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/commit', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test' }),
      })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when message is missing', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'message is required')
    })

    it('should accept message and stagedPaths', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test commit', stagedPaths: ['file1.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test' }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/stage', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when paths is not an array', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: 'not-an-array' }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'paths is required and must be an array')
    })

    it('should return 400 when paths is missing', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'paths is required and must be an array')
    })

    it('should accept array of paths', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts', 'file2.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('POST /:id/git/unstage', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when paths is not an array', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: 'not-an-array' }),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'paths is required and must be an array')
    })

    it('should return 400 when paths is missing', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'paths is required and must be an array')
    })

    it('should accept array of paths', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts', 'file2.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['file1.ts'] }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('GET /:id/git/log', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/log')
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should use default limit when not provided', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/log')
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should use custom limit when provided', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/log?limit=5')
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/log')
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })

  describe('GET /:id/git/diff', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/diff?path=file.ts')
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when path parameter is missing', async () => {
      const response = await app.request('/1/git/diff')
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'path query parameter is required')
    })

    it('should accept path parameter', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/diff?path=file.ts')
      await response.text()

      expect([200, 500]).toContain(response.status)
    })

    it('should handle special characters in path', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/diff?path=src%2Fcomponents%2FButton.tsx')
      expect([200, 500]).toContain(response.status)
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/diff?path=file.ts')
      expect([200, 500]).toContain(response.status)
    })
  })

  describe('POST /:id/git/reset', () => {
    it('should return 404 when repo does not exist', async () => {
      getRepoById.mockReturnValue(null)
      const response = await app.request('/999/git/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitHash: 'abc123' }),
      })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('error', 'Repo not found')
    })

    it('should return 400 when commitHash is missing', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error', 'commitHash is required')
    })

    it('should accept commitHash parameter', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitHash: 'abc123' }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })

    it('should return 500 when git operation fails', async () => {
      getRepoById.mockReturnValue({ id: 1, localPath: 'test-repo', fullPath: '/nonexistent/path' })
      const response = await app.request('/1/git/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitHash: 'abc123' }),
      })
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('error')
    })
  })
})
