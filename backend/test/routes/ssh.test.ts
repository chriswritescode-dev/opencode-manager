import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Hono } from 'hono'
import type { GitAuthService } from '../../src/services/git-auth'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    AUTH: {
      SECRET: 'test-secret-for-encryption'
    },
    OPENCODE: {
      PORT: 5551
    },
    SERVER: {
      PORT: 5003
    }
  },
  getReposPath: vi.fn(() => '/tmp/test-repos'),
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace')
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

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

import { createSSHRoutes } from '../../src/routes/ssh'

interface MockSSHHostKeyHandler {
  respond: ReturnType<typeof vi.fn>
  getPendingCount?: ReturnType<typeof vi.fn>
}

interface MockGitAuthService {
  sshHostKeyHandler: MockSSHHostKeyHandler | null
}

describe('SSH Routes', () => {
  let app: Hono
  let mockGitAuthService: MockGitAuthService

  beforeEach(() => {
    vi.clearAllMocks()
    mockGitAuthService = {
      sshHostKeyHandler: {
        respond: vi.fn().mockReturnValue({ success: true }),
        getPendingCount: vi.fn().mockReturnValue(0)
      }
    }
    app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)
  })

  describe('POST /host-key/respond', () => {
    it('should accept valid response with accept', async () => {
      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-123', response: 'accept' })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(mockGitAuthService.sshHostKeyHandler?.respond).toHaveBeenCalledWith({
        requestId: 'test-123',
        response: 'accept'
      })
    })

    it('should accept valid response with reject', async () => {
      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-456', response: 'reject' })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(mockGitAuthService.sshHostKeyHandler?.respond).toHaveBeenCalledWith({
        requestId: 'test-456',
        response: 'reject'
      })
    })

    it('should return 400 for invalid request body missing requestId', async () => {
      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'accept' })
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('success', false)
      expect(body).toHaveProperty('error', 'Invalid request body')
    })

    it('should return 400 for invalid request body missing response', async () => {
      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-123' })
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('success', false)
      expect(body).toHaveProperty('error', 'Invalid request body')
    })

    it('should return 400 for invalid response value', async () => {
      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-123', response: 'invalid' })
      })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('success', false)
      expect(body).toHaveProperty('error', 'Invalid request body')
    })

    it('should return 404 when handler not found', async () => {
      mockGitAuthService.sshHostKeyHandler = null
      app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)

      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-123', response: 'accept' })
      })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('success', false)
      expect(body).toHaveProperty('error', 'SSH host key handler not found')
    })

    it('should handle request ID matching correctly', async () => {
      const requestId = 'unique-request-id-12345'
      
      await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, response: 'accept' })
      })

      expect(mockGitAuthService.sshHostKeyHandler?.respond).toHaveBeenCalledWith({
        requestId: 'unique-request-id-12345',
        response: 'accept'
      })
    })

    it('should return handler result on success', async () => {
      mockGitAuthService.sshHostKeyHandler = {
        respond: vi.fn().mockReturnValue({ success: true }),
        getPendingCount: vi.fn()
      }
      app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)

      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-123', response: 'accept' })
      })
      const body = await response.json()

      expect(body).toEqual({ success: true })
    })

    it('should return handler error when request not found', async () => {
      mockGitAuthService.sshHostKeyHandler = {
        respond: vi.fn().mockReturnValue({ success: false, error: 'Request not found or expired' }),
        getPendingCount: vi.fn()
      }
      app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)

      const response = await app.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'expired-123', response: 'accept' })
      })
      const body = await response.json()

      expect(body).toEqual({ success: false, error: 'Request not found or expired' })
    })
  })

  describe('GET /host-key/status', () => {
    it('should return pending count correctly when zero', async () => {
      mockGitAuthService.sshHostKeyHandler = {
        respond: vi.fn(),
        getPendingCount: vi.fn().mockReturnValue(0)
      }
      app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)

      const response = await app.request('/host-key/status')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(body).toHaveProperty('pendingCount', 0)
    })

    it('should return pending count correctly when non-zero', async () => {
      mockGitAuthService.sshHostKeyHandler = {
        respond: vi.fn(),
        getPendingCount: vi.fn().mockReturnValue(5)
      }
      app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)

      const response = await app.request('/host-key/status')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('success', true)
      expect(body).toHaveProperty('pendingCount', 5)
    })

    it('should return 404 when handler not found', async () => {
      mockGitAuthService.sshHostKeyHandler = null
      app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)

      const response = await app.request('/host-key/status')
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toHaveProperty('success', false)
      expect(body).toHaveProperty('error', 'SSH host key handler not found')
    })

    it('should return 500 when getPendingCount is undefined', async () => {
      mockGitAuthService.sshHostKeyHandler = {
        respond: vi.fn(),
        getPendingCount: undefined as unknown as ReturnType<typeof vi.fn>
      }
      app = createSSHRoutes(mockGitAuthService as unknown as GitAuthService)

      const response = await app.request('/host-key/status')
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toHaveProperty('success', false)
    })
  })
})
