import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    checkHealth: vi.fn(),
    getLastStartupError: vi.fn(),
    getPort: vi.fn(() => 5551),
    getVersion: vi.fn(() => '1.0.0'),
    getMinVersion: vi.fn(() => '1.0.137'),
    isVersionSupported: vi.fn(() => true),
    isRestartPending: vi.fn(() => false),
    isSandboxEnforced: vi.fn(() => false),
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

vi.mock('../../src/services/sandbox/capability', () => ({
  detectSandboxCapability: vi.fn(),
}))

import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { createHealthRoutes } from '../../src/routes/health'
import { detectSandboxCapability } from '../../src/services/sandbox/capability'
import { forceProcessAttestation } from '../../src/services/opencode/process-identity'
import type { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'

const mockDetectSandboxCapability = detectSandboxCapability as ReturnType<typeof vi.fn>
const mockIsSandboxEnforced = opencodeServerManager.isSandboxEnforced as ReturnType<typeof vi.fn>

describe('Health Routes', () => {
  let healthApp: ReturnType<typeof createHealthRoutes>
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available or not writable' })
    mockIsSandboxEnforced.mockReturnValue(false)

    const mockPrepareGet = vi.fn()
    const mockQueryGet = vi.fn()
    mockDb = {
      prepare: vi.fn(() => ({
        get: mockPrepareGet,
      })),
      query: vi.fn(() => ({
        get: mockQueryGet,
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

    it('should include sandbox availability and enforcement in the payload', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })
      mockIsSandboxEnforced.mockReturnValue(true)
      mockDb.query().get.mockReturnValue({
        preferences: JSON.stringify({ sandbox: { enabled: true } }),
        updated_at: Date.now(),
      })
      forceProcessAttestation(true)
      try {
        const req = new Request('http://localhost/')
        const res = await healthApp.fetch(req)
        const json = await res.json() as Record<string, unknown>

        expect(res.status).toBe(200)
        expect(json.status).toBe('healthy')
        expect(json.sandbox).toEqual({ available: true, enabled: true, enforced: true, msbVersion: 'msb 0.3.1' })
      } finally {
        forceProcessAttestation(null)
      }
    })

    it('should keep the overall status unchanged when the sandbox runtime is unavailable', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('healthy')
      expect(json.sandbox).toEqual({
        available: false,
        enabled: false,
        enforced: false,
        reason: '/dev/kvm is not available or not writable',
      })
    })

    it('reports enabled-but-not-enforced when the preference is enabled but the child has not restarted', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      mockDb.query().get.mockReturnValue({
        preferences: JSON.stringify({ sandbox: { enabled: true } }),
        updated_at: Date.now(),
      })

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('healthy')
      expect(json.sandbox).toEqual({
        available: false,
        enabled: true,
        enforced: false,
        reason: '/dev/kvm is not available or not writable',
      })
    })

    it('reports an enforced running child even when the sandbox runtime is unavailable', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      mockIsSandboxEnforced.mockReturnValue(true)
      mockDb.query().get.mockReturnValue({
        preferences: JSON.stringify({ sandbox: { enabled: true } }),
        updated_at: Date.now(),
      })

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('healthy')
      expect(json.sandbox).toEqual({
        available: false,
        enabled: true,
        enforced: true,
        reason: '/dev/kvm is not available or not writable',
      })
    })

    it('reports an enforced running child while a disable-pending restart still runs it', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      mockIsSandboxEnforced.mockReturnValue(true)

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.sandbox).toEqual({
        available: false,
        enabled: false,
        enforced: true,
        reason: '/dev/kvm is not available or not writable',
      })
    })

    it('returns 200 with a safe sandbox status when the sandbox status lookup throws', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      mockDb.query.mockImplementationOnce(() => {
        throw new Error('user_preferences table is unavailable')
      })

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('healthy')
      expect(json.sandbox).toEqual({
        available: false,
        enabled: false,
        enforced: false,
        reason: 'user_preferences table is unavailable',
      })
    })

    it('keeps the running child enforcement in the fallback payload when the sandbox status lookup throws', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
      ;(opencodeServerManager.getLastStartupError as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      mockIsSandboxEnforced.mockReturnValue(true)
      mockDb.query.mockImplementationOnce(() => {
        throw new Error('user_preferences table is unavailable')
      })

      const req = new Request('http://localhost/')
      const res = await healthApp.fetch(req)
      const json = await res.json() as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(json.status).toBe('healthy')
      expect(json.sandbox).toEqual({
        available: false,
        enabled: false,
        enforced: true,
        reason: 'user_preferences table is unavailable',
      })
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

    it('reads the supervisor status without triggering recovery', async () => {
      mockDb.prepare().get.mockReturnValue({ 1: 1 })
      ;(opencodeServerManager.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue(true)
      const supervisor = {
        getStatus: vi.fn(() => ({
          state: 'healthy',
          healthy: true,
          port: 5551,
          version: '1.0.0',
          minVersion: '1.0.137',
          versionSupported: true,
          lastError: null,
          activeRecoveryAction: null,
          attemptedRecoveryActions: [],
          nextRecoveryAction: null,
          failureCount: 0,
          watching: true,
          updatedAt: new Date().toISOString(),
        })),
        checkNow: vi.fn(),
      } as unknown as OpenCodeSupervisor
      healthApp = createHealthRoutes(mockDb, supervisor)

      const res = await healthApp.fetch(new Request('http://localhost/'))
      const processesRes = await healthApp.fetch(new Request('http://localhost/processes'))

      expect(res.status).toBe(200)
      expect(processesRes.status).toBe(200)
      expect(supervisor.getStatus).toHaveBeenCalledTimes(2)
      expect(supervisor.checkNow).not.toHaveBeenCalled()
      expect(opencodeServerManager.checkHealth).toHaveBeenCalledTimes(2)
    })
  })
})
