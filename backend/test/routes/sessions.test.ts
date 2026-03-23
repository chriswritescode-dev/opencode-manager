import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import type { Database } from 'bun:sqlite'
import { createSessionRoutes } from '../../src/routes/sessions'
import { getSessionById, getAllSessions, updateSessionPublicOpencodeUrl } from '../../src/db/queries-session'

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

vi.mock('../../src/db/queries-session', () => ({
  getSessionById: vi.fn(),
  getAllSessions: vi.fn(),
  updateSessionPublicOpencodeUrl: vi.fn(),
}))

vi.mock('../../src/services/docker-orchestrator', () => ({
  DockerOrchestrator: vi.fn().mockImplementation(() => ({
    getContainerStatus: vi.fn().mockResolvedValue({ id: 'container', state: 'running' }),
  })),
}))

vi.mock('../../src/services/traefik-manager', () => ({
  TraefikManager: vi.fn().mockImplementation(() => ({
    ensureTraefik: vi.fn().mockResolvedValue(undefined),
    syncRoutes: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../src/services/devcontainer-request-manager', () => ({
  DevcontainerRequestManager: vi.fn().mockImplementation(() => ({
    listRequests: vi.fn().mockReturnValue([]),
    createRequest: vi.fn().mockResolvedValue({ id: 1, status: 'pending' }),
    approveRequest: vi.fn().mockResolvedValue(undefined),
    rejectRequest: vi.fn().mockResolvedValue(undefined),
    applyRequest: vi.fn().mockResolvedValue({ id: 1, status: 'applied' }),
  })),
}))

const getSessionByIdMock = getSessionById as MockedFunction<typeof getSessionById>
const getAllSessionsMock = getAllSessions as MockedFunction<typeof getAllSessions>
const updatePublicUrlMock = updateSessionPublicOpencodeUrl as MockedFunction<typeof updateSessionPublicOpencodeUrl>

const buildSession = () => ({
  id: 'session-1',
  name: 'session-1',
  status: 'stopped',
  repoMappings: [],
  opencodeContainerId: null,
  dindContainerId: null,
  codeServerContainerId: null,
  internalHostname: 'session-1.internal',
  opencodeUrl: 'http://session-1.internal:5551',
  codeServerUrl: 'http://session-1.internal:8080',
  sessionPath: '/workspace/sessions/session-1',
  opencodeStatePath: '/workspace/sessions/session-1/opencode',
  dindDataPath: '/workspace/sessions/session-1/dind',
  codeServerConfigPath: '/workspace/sessions/session-1/code-server',
  devcontainerTemplate: 'minimal',
  devcontainerConfigHash: 'hash',
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
  metadata: {},
})

describe('Session Routes', () => {
  let app: ReturnType<typeof createSessionRoutes>
  let mockDatabase: Database

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
    app = createSessionRoutes(mockDatabase)
  })

  describe('GET /:id', () => {
    it('should return session detail with containers and repos', async () => {
      getSessionByIdMock.mockReturnValue(buildSession())

      const response = await app.request('/session-1')
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('containers')
      expect(body).toHaveProperty('repos')
    })
  })

  describe('GET /', () => {
    it('should return sessions with containers and repos', async () => {
      getAllSessionsMock.mockReturnValue([buildSession()])

      const response = await app.request('/')
      const body = await response.json() as Array<Record<string, unknown>>

      expect(response.status).toBe(200)
      expect(body[0]).toHaveProperty('containers')
      expect(body[0]).toHaveProperty('repos')
    })
  })

  describe('POST /:id/public', () => {
    it('should update public access url', async () => {
      const base = buildSession()
      const updated = { ...base, publicOpencodeUrl: 'https://session-1.localhost' }
      getSessionByIdMock
        .mockReturnValueOnce(base)
        .mockReturnValueOnce(updated)
      getAllSessionsMock.mockReturnValue([updated])

      const response = await app.request('/session-1/public', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })

      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('publicOpencodeUrl')
      expect(updatePublicUrlMock).toHaveBeenCalled()
    })
  })

  describe('POST /:id/devcontainer-requests', () => {
    it('should create request', async () => {
      const response = await app.request('/session-1/devcontainer-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedBy: 'tester', changes: { addNixPackages: ['curl'] } }),
      })

      expect(response.status).toBe(201)
    })
  })
})
