import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    checkHealth: vi.fn(),
    getLastStartupError: vi.fn(),
    getPort: vi.fn(() => 5551),
    getVersion: vi.fn(() => '1.0.0'),
    getMinVersion: vi.fn(() => '1.0.137'),
    isVersionSupported: vi.fn(() => true),
  },
}))

vi.mock('bun:sqlite', () => ({
  Database: class Database {
    prepare() {
      return {
        get: vi.fn(),
      }
    }
  },
}))

import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { createHealthRoutes } from '../../src/routes/health'

describe('Health Routes', () => {
  let healthApp: ReturnType<typeof createHealthRoutes>
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    const mockPrepareGet = vi.fn()
    mockDb = {
      prepare: vi.fn(() => ({
        get: mockPrepareGet,
      })),
    } as any
    
    healthApp = createHealthRoutes(mockDb)
  })

  describe('GET /', () => {
    it('should return healthy status when database and opencode are healthy', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('healthy')
      expect(json.database).toBe('connected')
      expect(json.opencode).toBe('healthy')
    })

    it('should return degraded status when opencode is unhealthy but no startup error', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('degraded')
      expect(json.opencode).toBe('unhealthy')
    })

    it('should return unhealthy status with 503 when startup error exists and opencode unhealthy', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce('Failed to start OpenCode server')

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(503)
      expect(json.status).toBe('unhealthy')
      expect(json.error).toBe('Failed to start OpenCode server')
    })

    it('should return degraded status when database is disconnected but opencode healthy', async () => {
      mockDb.prepare().get.mockReturnValue(null)
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('degraded')
      expect(json.database).toBe('disconnected')
    })

    it('should return 503 when health check throws an error', async () => {
      mockDb.prepare().get.mockImplementationOnce(() => {
        throw new Error('Database error')
      })

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(503)
      expect(json.status).toBe('unhealthy')
      expect(json.error).toBe('Database error')
    })
  })
})
