import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { initializeDatabase } from '../../src/db/schema'
import { SessionManager } from '../../src/services/session-manager'
import { DockerOrchestrator } from '../../src/services/docker-orchestrator'
import type { CreateSessionInput } from '@opencode-manager/shared'

vi.mock('../../src/services/docker-orchestrator')

describe('SessionManager', () => {
  let database: Database
  let dockerOrchestrator: DockerOrchestrator
  let sessionManager: SessionManager

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    dockerOrchestrator = new DockerOrchestrator()
    sessionManager = new SessionManager(database, dockerOrchestrator)

    vi.mocked(dockerOrchestrator.createSessionPod).mockResolvedValue()
    vi.mocked(dockerOrchestrator.stopSessionPod).mockResolvedValue()
    vi.mocked(dockerOrchestrator.destroySessionPod).mockResolvedValue()
    vi.mocked(dockerOrchestrator.getContainerId).mockResolvedValue('container-123')
  })

  describe('createSession', () => {
    it('should create a session with sanitized name', async () => {
      const input: CreateSessionInput = {
        name: 'My Test Session!',
        repos: [],
      }

      const session = await sessionManager.createSession(input)

      expect(session.name).toBe('my-test-session')
      expect(session.status).toBe('creating')
      expect(session.sessionPath).toContain('my-test-session')
    })

    it('should reject duplicate session names', async () => {
      const input: CreateSessionInput = {
        name: 'duplicate-session',
        repos: [],
      }

      await sessionManager.createSession(input)

      await expect(sessionManager.createSession(input)).rejects.toThrow(
        "Session with name 'duplicate-session' already exists"
      )
    })

    it('should use default template if not specified', async () => {
      const input: CreateSessionInput = {
        name: 'test-session',
        repos: [],
      }

      const session = await sessionManager.createSession(input)

      expect(session.devcontainerTemplate).toBe('minimal')
    })

    it('should use specified template', async () => {
      const input: CreateSessionInput = {
        name: 'test-session',
        repos: [],
        devcontainerTemplate: 'nodejs-fullstack',
      }

      const session = await sessionManager.createSession(input)

      expect(session.devcontainerTemplate).toBe('nodejs-fullstack')
    })

    it('should create public URL if requested', async () => {
      const input: CreateSessionInput = {
        name: 'public-session',
        repos: [],
        enablePublicAccess: true,
      }

      const session = await sessionManager.createSession(input)

      expect(session.publicOpencodeUrl).toBeDefined()
      expect(session.publicOpencodeUrl).toContain('public-session')
    })

    it('should store metadata', async () => {
      const input: CreateSessionInput = {
        name: 'metadata-session',
        repos: [],
        metadata: {
          tags: ['test', 'feature'],
          assignee: 'user@example.com',
        },
      }

      const session = await sessionManager.createSession(input)

      expect(session.metadata.tags).toEqual(['test', 'feature'])
      expect(session.metadata.assignee).toBe('user@example.com')
    })
  })

  describe('getSession', () => {
    it('should retrieve session by id', async () => {
      const input: CreateSessionInput = {
        name: 'test-session',
        repos: [],
      }

      const created = await sessionManager.createSession(input)
      const retrieved = await sessionManager.getSession(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.name).toBe('test-session')
    })

    it('should return null for non-existent session', async () => {
      const retrieved = await sessionManager.getSession('non-existent-id')
      expect(retrieved).toBeNull()
    })
  })

  describe('getSessionByName', () => {
    it('should retrieve session by name', async () => {
      const input: CreateSessionInput = {
        name: 'named-session',
        repos: [],
      }

      await sessionManager.createSession(input)
      const retrieved = await sessionManager.getSessionByName('named-session')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe('named-session')
    })
  })

  describe('listSessions', () => {
    it('should list all sessions', async () => {
      const input1: CreateSessionInput = { name: 'session-1', repos: [] }
      const input2: CreateSessionInput = { name: 'session-2', repos: [] }

      await sessionManager.createSession(input1)
      await sessionManager.createSession(input2)

      const sessions = await sessionManager.listSessions()

      expect(sessions.length).toBe(2)
    })

    it('should filter sessions by status', async () => {
      const input1: CreateSessionInput = { name: 'session-1', repos: [] }
      const input2: CreateSessionInput = { name: 'session-2', repos: [] }

      const session1 = await sessionManager.createSession(input1)
      await sessionManager.createSession(input2)

      await sessionManager.updateSessionStatus(session1.id, 'running')

      const runningSessions = await sessionManager.listSessions({ status: 'running' })

      expect(runningSessions.length).toBe(1)
      expect(runningSessions[0]?.status).toBe('running')
    })
  })

  describe('updateSessionStatus', () => {
    it('should update session status', async () => {
      const input: CreateSessionInput = {
        name: 'status-test',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.updateSessionStatus(session.id, 'running')

      const updated = await sessionManager.getSession(session.id)
      expect(updated?.status).toBe('running')
    })
  })

  describe('startSession', () => {
    it('should start a session', async () => {
      const input: CreateSessionInput = {
        name: 'start-test',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.startSession(session.id)

      expect(dockerOrchestrator.createSessionPod).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionName: 'start-test',
        })
      )
    })

    it('should update status to running on successful start', async () => {
      const input: CreateSessionInput = {
        name: 'start-success',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.startSession(session.id)

      const updated = await sessionManager.getSession(session.id)
      expect(updated?.status).toBe('running')
    })

    it('should update status to error on failed start', async () => {
      vi.mocked(dockerOrchestrator.createSessionPod).mockRejectedValueOnce(
        new Error('Docker error')
      )

      const input: CreateSessionInput = {
        name: 'start-fail',
        repos: [],
      }

      const session = await sessionManager.createSession(input)

      await expect(sessionManager.startSession(session.id)).rejects.toThrow('Docker error')

      const updated = await sessionManager.getSession(session.id)
      expect(updated?.status).toBe('error')
    })

    it('should not start already running session', async () => {
      const input: CreateSessionInput = {
        name: 'already-running',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.updateSessionStatus(session.id, 'running')

      await sessionManager.startSession(session.id)

      expect(dockerOrchestrator.createSessionPod).not.toHaveBeenCalled()
    })
  })

  describe('stopSession', () => {
    it('should stop a running session', async () => {
      const input: CreateSessionInput = {
        name: 'stop-test',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.updateSessionStatus(session.id, 'running')
      await sessionManager.stopSession(session.id)

      expect(dockerOrchestrator.stopSessionPod).toHaveBeenCalledWith(
        'stop-test',
        expect.stringContaining('stop-test')
      )

      const updated = await sessionManager.getSession(session.id)
      expect(updated?.status).toBe('stopped')
    })
  })

  describe('restartSession', () => {
    it('should restart a session', async () => {
      const input: CreateSessionInput = {
        name: 'restart-test',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.updateSessionStatus(session.id, 'running')
      await sessionManager.restartSession(session.id)

      expect(dockerOrchestrator.stopSessionPod).toHaveBeenCalled()
      expect(dockerOrchestrator.createSessionPod).toHaveBeenCalled()
    })
  })

  describe('deleteSession', () => {
    it('should delete a session', async () => {
      const input: CreateSessionInput = {
        name: 'delete-test',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.deleteSession(session.id)

      const deleted = await sessionManager.getSession(session.id)
      expect(deleted).toBeNull()
    })

    it('should call Docker cleanup', async () => {
      const input: CreateSessionInput = {
        name: 'cleanup-test',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.deleteSession(session.id, false)

      expect(dockerOrchestrator.destroySessionPod).toHaveBeenCalledWith(
        'cleanup-test',
        expect.stringContaining('cleanup-test')
      )
    })

    it('should handle missing session gracefully', async () => {
      await expect(
        sessionManager.deleteSession('non-existent')
      ).rejects.toThrow('Session not found')
    })
  })

  describe('name sanitization', () => {
    it('should convert to lowercase', async () => {
      const input: CreateSessionInput = {
        name: 'UPPERCASE',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      expect(session.name).toBe('uppercase')
    })

    it('should replace special characters with hyphens', async () => {
      const input: CreateSessionInput = {
        name: 'session@name#with$special%chars',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      expect(session.name).toBe('session-name-with-special-chars')
    })

    it('should collapse multiple hyphens', async () => {
      const input: CreateSessionInput = {
        name: 'session---name',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      expect(session.name).toBe('session-name')
    })

    it('should trim leading/trailing hyphens', async () => {
      const input: CreateSessionInput = {
        name: '-session-name-',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      expect(session.name).toBe('session-name')
    })

    it('should truncate long names', async () => {
      const input: CreateSessionInput = {
        name: 'a'.repeat(100),
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      expect(session.name.length).toBeLessThanOrEqual(63)
    })
  })
})
