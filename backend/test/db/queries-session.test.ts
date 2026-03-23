import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { initializeDatabase } from '../../src/db/schema'
import * as db from '../../src/db/queries'
import type { Session, DevcontainerTemplate, DevcontainerConfig } from '@opencode-manager/shared'

describe('Session Database Queries', () => {
  let database: Database

  beforeEach(() => {
    database = initializeDatabase(':memory:')
  })

  describe('Session CRUD', () => {
    it('should create a session', () => {
      const session: Session = {
        id: 'test-session-1',
        name: 'test-session',
        repoMappings: [],
        status: 'creating',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'test-session.oc',
        opencodeUrl: 'http://test-session-opencode.oc:5551',
        codeServerUrl: 'https://test-session-code.localhost',
        sessionPath: '/workspace/sessions/test-session',
        opencodeStatePath: '/workspace/sessions/test-session/state',
        dindDataPath: '/workspace/sessions/test-session/docker',
        codeServerConfigPath: '/workspace/sessions/test-session/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'abc123',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: { tags: ['test'] },
      }

      const created = db.createSession(database, session)
      expect(created.id).toBe(session.id)
      expect(created.name).toBe(session.name)
    })

    it('should get session by id', () => {
      const session: Session = {
        id: 'test-session-2',
        name: 'test-session-2',
        repoMappings: [],
        status: 'running',
        opencodeContainerId: 'opencode-123',
        dindContainerId: 'dind-123',
        codeServerContainerId: 'code-123',
        internalHostname: 'test-session-2.oc',
        opencodeUrl: 'http://test-session-2-opencode.oc:5551',
        codeServerUrl: 'https://test-session-2-code.localhost',
        sessionPath: '/workspace/sessions/test-session-2',
        opencodeStatePath: '/workspace/sessions/test-session-2/state',
        dindDataPath: '/workspace/sessions/test-session-2/docker',
        codeServerConfigPath: '/workspace/sessions/test-session-2/code-server',
        devcontainerTemplate: 'nodejs',
        devcontainerConfigHash: 'def456',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)
      const found = db.getSessionById(database, 'test-session-2')

      expect(found).not.toBeNull()
      expect(found?.id).toBe('test-session-2')
      expect(found?.name).toBe('test-session-2')
      expect(found?.status).toBe('running')
      expect(found?.opencodeContainerId).toBe('opencode-123')
    })

    it('should get session by name', () => {
      const session: Session = {
        id: 'test-session-3',
        name: 'my-unique-session',
        repoMappings: [],
        status: 'stopped',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'my-unique-session.oc',
        opencodeUrl: 'http://my-unique-session-opencode.oc:5551',
        codeServerUrl: 'https://my-unique-session-code.localhost',
        sessionPath: '/workspace/sessions/my-unique-session',
        opencodeStatePath: '/workspace/sessions/my-unique-session/state',
        dindDataPath: '/workspace/sessions/my-unique-session/docker',
        codeServerConfigPath: '/workspace/sessions/my-unique-session/code-server',
        devcontainerTemplate: 'python',
        devcontainerConfigHash: 'ghi789',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)
      const found = db.getSessionByName(database, 'my-unique-session')

      expect(found).not.toBeNull()
      expect(found?.id).toBe('test-session-3')
      expect(found?.name).toBe('my-unique-session')
    })

    it('should return null for non-existent session', () => {
      const found = db.getSessionById(database, 'non-existent')
      expect(found).toBeNull()
    })

    it('should get all sessions', () => {
      const session1: Session = {
        id: 'session-1',
        name: 'session-1',
        repoMappings: [],
        status: 'running',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'session-1.oc',
        opencodeUrl: 'http://session-1-opencode.oc:5551',
        codeServerUrl: 'https://session-1-code.localhost',
        sessionPath: '/workspace/sessions/session-1',
        opencodeStatePath: '/workspace/sessions/session-1/state',
        dindDataPath: '/workspace/sessions/session-1/docker',
        codeServerConfigPath: '/workspace/sessions/session-1/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash1',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      const session2: Session = {
        ...session1,
        id: 'session-2',
        name: 'session-2',
        internalHostname: 'session-2.oc',
        opencodeUrl: 'http://session-2-opencode.oc:5551',
        codeServerUrl: 'https://session-2-code.localhost',
        sessionPath: '/workspace/sessions/session-2',
        opencodeStatePath: '/workspace/sessions/session-2/state',
        dindDataPath: '/workspace/sessions/session-2/docker',
        codeServerConfigPath: '/workspace/sessions/session-2/code-server',
      }

      db.createSession(database, session1)
      db.createSession(database, session2)

      const all = db.getAllSessions(database)
      expect(all.length).toBe(2)
    })

    it('should filter sessions by status', () => {
      const runningSession: Session = {
        id: 'running-1',
        name: 'running-1',
        repoMappings: [],
        status: 'running',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'running-1.oc',
        opencodeUrl: 'http://running-1-opencode.oc:5551',
        codeServerUrl: 'https://running-1-code.localhost',
        sessionPath: '/workspace/sessions/running-1',
        opencodeStatePath: '/workspace/sessions/running-1/state',
        dindDataPath: '/workspace/sessions/running-1/docker',
        codeServerConfigPath: '/workspace/sessions/running-1/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash1',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      const stoppedSession: Session = {
        ...runningSession,
        id: 'stopped-1',
        name: 'stopped-1',
        status: 'stopped',
        internalHostname: 'stopped-1.oc',
        opencodeUrl: 'http://stopped-1-opencode.oc:5551',
        codeServerUrl: 'https://stopped-1-code.localhost',
        sessionPath: '/workspace/sessions/stopped-1',
        opencodeStatePath: '/workspace/sessions/stopped-1/state',
        dindDataPath: '/workspace/sessions/stopped-1/docker',
        codeServerConfigPath: '/workspace/sessions/stopped-1/code-server',
      }

      db.createSession(database, runningSession)
      db.createSession(database, stoppedSession)

      const running = db.getSessionsByStatus(database, 'running')
      expect(running.length).toBe(1)
      expect(running[0]?.status).toBe('running')

      const stopped = db.getSessionsByStatus(database, 'stopped')
      expect(stopped.length).toBe(1)
      expect(stopped[0]?.status).toBe('stopped')
    })

    it('should update session status', () => {
      const session: Session = {
        id: 'update-test',
        name: 'update-test',
        repoMappings: [],
        status: 'creating',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'update-test.oc',
        opencodeUrl: 'http://update-test-opencode.oc:5551',
        codeServerUrl: 'https://update-test-code.localhost',
        sessionPath: '/workspace/sessions/update-test',
        opencodeStatePath: '/workspace/sessions/update-test/state',
        dindDataPath: '/workspace/sessions/update-test/docker',
        codeServerConfigPath: '/workspace/sessions/update-test/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)
      db.updateSessionStatus(database, 'update-test', 'running')

      const updated = db.getSessionById(database, 'update-test')
      expect(updated?.status).toBe('running')
    })

    it('should update public opencode url', () => {
      const session: Session = {
        id: 'public-test',
        name: 'public-test',
        repoMappings: [],
        status: 'creating',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'public-test.oc',
        opencodeUrl: 'http://public-test-opencode.oc:5551',
        codeServerUrl: 'https://public-test-code.localhost',
        sessionPath: '/workspace/sessions/public-test',
        opencodeStatePath: '/workspace/sessions/public-test/state',
        dindDataPath: '/workspace/sessions/public-test/docker',
        codeServerConfigPath: '/workspace/sessions/public-test/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)
      db.updateSessionPublicOpencodeUrl(database, 'public-test', 'https://public-test.localhost')

      const updated = db.getSessionById(database, 'public-test')
      expect(updated?.publicOpencodeUrl).toBe('https://public-test.localhost')
    })

    it('should update devcontainer template', () => {
      const session: Session = {
        id: 'template-test',
        name: 'template-test',
        repoMappings: [],
        status: 'creating',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'template-test.oc',
        opencodeUrl: 'http://template-test-opencode.oc:5551',
        codeServerUrl: 'https://template-test-code.localhost',
        sessionPath: '/workspace/sessions/template-test',
        opencodeStatePath: '/workspace/sessions/template-test/state',
        dindDataPath: '/workspace/sessions/template-test/docker',
        codeServerConfigPath: '/workspace/sessions/template-test/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)
      db.updateSessionDevcontainerTemplate(database, 'template-test', 'custom-template')

      const updated = db.getSessionById(database, 'template-test')
      expect(updated?.devcontainerTemplate).toBe('custom-template')
    })

    it('should update container IDs', () => {
      const session: Session = {
        id: 'container-test',
        name: 'container-test',
        repoMappings: [],
        status: 'running',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'container-test.oc',
        opencodeUrl: 'http://container-test-opencode.oc:5551',
        codeServerUrl: 'https://container-test-code.localhost',
        sessionPath: '/workspace/sessions/container-test',
        opencodeStatePath: '/workspace/sessions/container-test/state',
        dindDataPath: '/workspace/sessions/container-test/docker',
        codeServerConfigPath: '/workspace/sessions/container-test/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)
      db.updateSessionContainerIds(database, 'container-test', {
        opencode: 'oc-123',
        dind: 'dind-456',
        codeServer: 'code-789',
      })

      const updated = db.getSessionById(database, 'container-test')
      expect(updated?.opencodeContainerId).toBe('oc-123')
      expect(updated?.dindContainerId).toBe('dind-456')
      expect(updated?.codeServerContainerId).toBe('code-789')
    })

    it('should delete session', () => {
      const session: Session = {
        id: 'delete-test',
        name: 'delete-test',
        repoMappings: [],
        status: 'stopped',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'delete-test.oc',
        opencodeUrl: 'http://delete-test-opencode.oc:5551',
        codeServerUrl: 'https://delete-test-code.localhost',
        sessionPath: '/workspace/sessions/delete-test',
        opencodeStatePath: '/workspace/sessions/delete-test/state',
        dindDataPath: '/workspace/sessions/delete-test/docker',
        codeServerConfigPath: '/workspace/sessions/delete-test/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      db.createSession(database, session)
      db.deleteSession(database, 'delete-test')

      const deleted = db.getSessionById(database, 'delete-test')
      expect(deleted).toBeNull()
    })
  })

  describe('Devcontainer Template CRUD', () => {
    it('should create a devcontainer template', () => {
      const config: DevcontainerConfig = {
        name: 'test-template',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            NIX_PACKAGES: 'git nodejs_22',
          },
        },
      }

      const template: DevcontainerTemplate = {
        name: 'test-template',
        config,
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      const created = db.createDevcontainerTemplate(database, template)
      expect(created.name).toBe('test-template')
    })

    it('should get template by name', () => {
      const config: DevcontainerConfig = {
        name: 'nodejs-template',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            NIX_PACKAGES: 'git nodejs_22 postgresql',
          },
        },
      }

      const template: DevcontainerTemplate = {
        name: 'nodejs-template',
        config,
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      db.createDevcontainerTemplate(database, template)
      const found = db.getDevcontainerTemplate(database, 'nodejs-template')

      expect(found).not.toBeNull()
      expect(found?.name).toBe('nodejs-template')
      expect(found?.isBuiltIn).toBe(true)
      expect(found?.config.build.args.NIX_PACKAGES).toContain('postgresql')
    })

    it('should get all templates', () => {
      const template1: DevcontainerTemplate = {
        name: 'template-1',
        config: {
          name: 'template-1',
          build: { dockerfile: 'Dockerfile.nix', context: '.', args: { NIX_PACKAGES: 'git' } },
        },
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      const template2: DevcontainerTemplate = {
        name: 'template-2',
        config: {
          name: 'template-2',
          build: { dockerfile: 'Dockerfile.nix', context: '.', args: { NIX_PACKAGES: 'python3' } },
        },
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      db.createDevcontainerTemplate(database, template1)
      db.createDevcontainerTemplate(database, template2)

      const all = db.getAllDevcontainerTemplates(database)
      expect(all.length).toBe(2)
    })

    it('should update template config', () => {
      const template: DevcontainerTemplate = {
        name: 'update-template',
        config: {
          name: 'update-template',
          build: { dockerfile: 'Dockerfile.nix', context: '.', args: { NIX_PACKAGES: 'git' } },
        },
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      db.createDevcontainerTemplate(database, template)

      const newConfig: DevcontainerConfig = {
        name: 'update-template',
        build: { dockerfile: 'Dockerfile.nix', context: '.', args: { NIX_PACKAGES: 'git nodejs_22' } },
      }

      db.updateDevcontainerTemplate(database, 'update-template', newConfig)

      const updated = db.getDevcontainerTemplate(database, 'update-template')
      expect(updated?.config.build.args.NIX_PACKAGES).toBe('git nodejs_22')
    })

    it('should delete template', () => {
      const template: DevcontainerTemplate = {
        name: 'delete-template',
        config: {
          name: 'delete-template',
          build: { dockerfile: 'Dockerfile.nix', context: '.', args: { NIX_PACKAGES: 'git' } },
        },
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      db.createDevcontainerTemplate(database, template)
      db.deleteDevcontainerTemplate(database, 'delete-template')

      const deleted = db.getDevcontainerTemplate(database, 'delete-template')
      expect(deleted).toBeNull()
    })

    it('should get sessions by template', () => {
      const template: DevcontainerTemplate = {
        name: 'shared-template',
        config: {
          name: 'shared-template',
          build: { dockerfile: 'Dockerfile.nix', context: '.', args: { NIX_PACKAGES: 'git' } },
        },
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      db.createDevcontainerTemplate(database, template)

      const session1: Session = {
        id: 'session-with-template-1',
        name: 'session-with-template-1',
        repoMappings: [],
        status: 'running',
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'session-with-template-1.oc',
        opencodeUrl: 'http://session-with-template-1-opencode.oc:5551',
        codeServerUrl: 'https://session-with-template-1-code.localhost',
        sessionPath: '/workspace/sessions/session-with-template-1',
        opencodeStatePath: '/workspace/sessions/session-with-template-1/state',
        dindDataPath: '/workspace/sessions/session-with-template-1/docker',
        codeServerConfigPath: '/workspace/sessions/session-with-template-1/code-server',
        devcontainerTemplate: 'shared-template',
        devcontainerConfigHash: 'hash1',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      }

      const session2: Session = {
        ...session1,
        id: 'session-with-template-2',
        name: 'session-with-template-2',
        internalHostname: 'session-with-template-2.oc',
        opencodeUrl: 'http://session-with-template-2-opencode.oc:5551',
        codeServerUrl: 'https://session-with-template-2-code.localhost',
        sessionPath: '/workspace/sessions/session-with-template-2',
        opencodeStatePath: '/workspace/sessions/session-with-template-2/state',
        dindDataPath: '/workspace/sessions/session-with-template-2/docker',
        codeServerConfigPath: '/workspace/sessions/session-with-template-2/code-server',
      }

      db.createSession(database, session1)
      db.createSession(database, session2)

      const sessions = db.getSessionsByTemplate(database, 'shared-template')
      expect(sessions.length).toBe(2)
    })
  })
})
