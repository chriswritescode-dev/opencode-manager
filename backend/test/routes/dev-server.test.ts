import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/services/dev-server/manager', () => ({
  getDevServerState: vi.fn(),
  getDevServerPort: vi.fn(() => 5100),
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

import { getDevServerState } from '../../src/services/dev-server/manager'
import { getRepoById } from '../../src/db/queries'
import { createDevServerRoutes } from '../../src/routes/dev-server'

describe('DevServer Management Routes', () => {
  let devServerApp: ReturnType<typeof createDevServerRoutes>
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {} as any
    devServerApp = createDevServerRoutes(mockDb)
  })

  describe('GET /:repoId/status', () => {
    it('returns 404 when repo is not found', async () => {
      vi.mocked(getRepoById).mockReturnValue(null)

      const res = await devServerApp.fetch(new Request('http://localhost/999/status'))
      expect(res.status).toBe(404)
      const body = await res.json() as Record<string, unknown>
      expect(body.error).toBe('Repository not found')
    })

    it('returns 400 for invalid repoId', async () => {
      const res = await devServerApp.fetch(new Request('http://localhost/abc/status'))
      expect(res.status).toBe(400)
    })

    it('returns status with an absolute preview url derived from the request host', async () => {
      const mockRepo = { id: 1, fullPath: '/test/repo', repoUrl: null, localPath: '/test/repo' }
      vi.mocked(getRepoById).mockReturnValue(mockRepo as any)
      vi.mocked(getDevServerState).mockImplementation(async (_db, repoId, previewUrl) => ({
        repoId,
        status: 'running' as const,
        port: 5100,
        error: null,
        previewUrl,
      }))

      const res = await devServerApp.fetch(new Request('http://manager.example:5003/1/status', {
        headers: { host: 'manager.example:5003' },
      }))
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.status).toBe('running')
      expect(body.port).toBe(5100)
      expect(body.previewUrl).toBe('http://manager.example:3056/')
      expect(getDevServerState).toHaveBeenCalledWith(mockDb, 1, 'http://manager.example:3056/')
    })
  })
})
