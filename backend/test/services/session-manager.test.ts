import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { initializeDatabase } from '../../src/db/schema'
import { SessionManager } from '../../src/services/session-manager'
import { DockerOrchestrator } from '../../src/services/docker-orchestrator'
import type { WorktreeManager } from '../../src/services/worktree-manager'
import type { ImageBuilder } from '../../src/services/image-builder'
import type { CodeServerManager } from '../../src/services/code-server-manager'
import type { TraefikManager } from '../../src/services/traefik-manager'
import type { CreateSessionInput, DevcontainerConfig } from '@opencode-manager/shared'
import * as db from '../../src/db/queries'

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/services/docker-orchestrator')

describe('SessionManager', () => {
  let database: Database
  let dockerOrchestrator: DockerOrchestrator
  let sessionManager: SessionManager
  let worktreeManager: WorktreeManager
  let imageBuilder: ImageBuilder
  let codeServerManager: CodeServerManager
  let traefikManager: TraefikManager

  beforeEach(() => {
    database = initializeDatabase(':memory:')
    dockerOrchestrator = new DockerOrchestrator()
    worktreeManager = {
      createWorktreeForSession: vi.fn(),
      removeWorktree: vi.fn(),
    } as unknown as WorktreeManager
    imageBuilder = {
      ensureImage: vi.fn().mockResolvedValue('opencode-session:minimal-hash'),
    } as unknown as ImageBuilder
    codeServerManager = {
      prepareSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as CodeServerManager
    traefikManager = {
      ensureTraefik: vi.fn().mockResolvedValue(undefined),
      syncRoutes: vi.fn().mockResolvedValue(undefined),
    } as unknown as TraefikManager
    sessionManager = new SessionManager(
      database,
      dockerOrchestrator,
      worktreeManager,
      undefined,
      imageBuilder,
      codeServerManager,
      traefikManager
    )

    const minimalConfig: DevcontainerConfig = {
      name: 'minimal',
      build: {
        dockerfile: 'Dockerfile.nix',
        context: '.',
        args: {
          NIX_PACKAGES: 'git',
        },
      },
    }

    const fullstackConfig: DevcontainerConfig = {
      name: 'nodejs-fullstack',
      build: {
        dockerfile: 'Dockerfile.nix',
        context: '.',
        args: {
          NIX_PACKAGES: 'git nodejs_22',
        },
      },
    }

    db.createDevcontainerTemplate(database, {
      name: 'minimal',
      config: minimalConfig,
      isBuiltIn: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    db.createDevcontainerTemplate(database, {
      name: 'nodejs-fullstack',
      config: fullstackConfig,
      isBuiltIn: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    vi.mocked(dockerOrchestrator.createSessionPod).mockResolvedValue()
    vi.mocked(dockerOrchestrator.waitForContainersHealthy).mockResolvedValue()
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

    it('should create worktrees for repos', async () => {
      const repo = db.createRepo(database, {
        localPath: 'repo-1',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isLocal: true,
      })

      vi.mocked(worktreeManager.createWorktreeForSession).mockResolvedValue({
        repoId: repo.id,
        repoName: repo.localPath,
        worktreePath: `/workspace/repos/${repo.localPath}/session-worktree`,
        symlinkPath: `/workspace/sessions/session-worktree/${repo.localPath}`,
        containerPath: `/workspace/${repo.localPath}`,
        branch: 'feature',
      })

      const input: CreateSessionInput = {
        name: 'session-worktree',
        repos: [{ repoId: repo.id, branch: 'feature' }],
      }

      const session = await sessionManager.createSession(input)

      expect(worktreeManager.createWorktreeForSession).toHaveBeenCalledWith(
        repo,
        'session-worktree',
        'feature'
      )
      expect(session.repoMappings).toHaveLength(1)
      expect(session.repoMappings[0]?.repoId).toBe(repo.id)
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

  describe('getSessionDetail', () => {
    it('should return session with container status', async () => {
      const input: CreateSessionInput = {
        name: 'detail-test',
        repos: [],
      }

      const session = await sessionManager.createSession(input)

      vi.mocked(dockerOrchestrator.getContainerStatus)
        .mockResolvedValueOnce({ id: 'opencode', name: 'opencode', state: 'running' })
        .mockResolvedValueOnce({ id: 'dind', name: 'dind', state: 'running' })
        .mockResolvedValueOnce({ id: 'code', name: 'code', state: 'running' })

      const detail = await sessionManager.getSessionDetail(session.id)

      expect(detail).not.toBeNull()
      expect(detail?.containers.opencode?.state).toBe('running')
      expect(detail?.containers.dind?.state).toBe('running')
      expect(detail?.containers.codeServer?.state).toBe('running')
      expect(detail?.repos).toEqual(detail?.repoMappings)
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

  describe('setPublicAccess', () => {
    it('should update public opencode url and sync routes', async () => {
      const input: CreateSessionInput = {
        name: 'public-access',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      const updated = await sessionManager.setPublicAccess(session.id, true)

      expect(updated?.publicOpencodeUrl).toContain('public-access')
      expect(traefikManager.syncRoutes).toHaveBeenCalled()
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

      expect(traefikManager.ensureTraefik).toHaveBeenCalled()
      expect(codeServerManager.prepareSession).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ name: 'minimal' })
      )
      expect(dockerOrchestrator.createSessionPod).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionName: 'start-test',
        })
      )
      expect(dockerOrchestrator.waitForContainersHealthy).toHaveBeenCalledWith([
        'start-test-dind',
        'start-test-opencode',
        'start-test-code',
      ])
      expect(traefikManager.syncRoutes).toHaveBeenCalled()
    })

    it('should pass template NIX packages to compose config', async () => {
      const input: CreateSessionInput = {
        name: 'nix-packages-test',
        repos: [],
        devcontainerTemplate: 'nodejs-fullstack',
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.startSession(session.id)

      expect(dockerOrchestrator.createSessionPod).toHaveBeenCalledWith(
        expect.objectContaining({
          nixPackages: 'git nodejs_22',
          devcontainerTemplate: 'nodejs-fullstack',
          imageId: 'opencode-session:minimal-hash',
        })
      )
    })

    it('should track template usage on start', async () => {
      const input: CreateSessionInput = {
        name: 'usage-start',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.startSession(session.id)

      const usage = db.getTemplateUsageForSession(database, session.id)
      expect(usage.length).toBe(1)
      expect(usage[0]?.template_name).toBe('minimal')
      expect(usage[0]?.ended_at).toBeNull()
    })

    it('should update status to running on successful start', async () => {
      const input: CreateSessionInput = {
        name: 'start-success',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      const statusSpy = vi.spyOn(db, 'updateSessionStatus')
      await sessionManager.startSession(session.id)

      expect(statusSpy).toHaveBeenCalledWith(database, session.id, 'building')
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

      const usage = db.getTemplateUsageForSession(database, session.id)
      expect(usage[0]?.ended_at).not.toBeNull()
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

    it('should end and restart template usage', async () => {
      const input: CreateSessionInput = {
        name: 'restart-usage',
        repos: [],
      }

      const session = await sessionManager.createSession(input)
      await sessionManager.startSession(session.id)

      await sessionManager.restartSession(session.id)

      const usage = db.getTemplateUsageForSession(database, session.id)
      expect(usage.length).toBeGreaterThanOrEqual(2)
      expect(usage[0]?.ended_at).toBeNull()
      expect(usage[1]?.ended_at).not.toBeNull()
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
