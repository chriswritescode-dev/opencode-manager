import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevcontainerRequestManager } from '../../src/services/devcontainer-request-manager'
import { DevcontainerManager } from '../../src/services/devcontainer-manager'
import { SessionManager } from '../../src/services/session-manager'
import { initializeDatabase } from '../../src/db/schema'
import { Database } from 'bun:sqlite'
import type { DevcontainerConfig } from '@opencode-manager/shared'

vi.mock('../../src/utils/process', () => ({
  execCommand: vi.fn().mockResolvedValue(''),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockImplementation((path: string) => {
    if (path.includes('minimal.json')) {
      return Promise.resolve(JSON.stringify({
        name: 'Minimal',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: { NIX_PACKAGES: 'git curl' }
        }
      }))
    }
    if (path.includes('Dockerfile.nix')) {
      return Promise.resolve('FROM nixos/nix:2.18.1')
    }
    return Promise.reject(new Error('File not found'))
  }),
  rm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/services/docker-orchestrator')

describe('DevcontainerRequestManager', () => {
  let database: Database
  let devcontainerManager: DevcontainerManager
  let sessionManager: SessionManager
  let requestManager: DevcontainerRequestManager

  beforeEach(async () => {
    database = initializeDatabase(':memory:')
    devcontainerManager = new DevcontainerManager(database)
    sessionManager = new SessionManager(database, new (await import('../../src/services/docker-orchestrator')).DockerOrchestrator())
    requestManager = new DevcontainerRequestManager(database, devcontainerManager, sessionManager)

    const config: DevcontainerConfig = {
      name: 'minimal',
      build: {
        dockerfile: 'Dockerfile.nix',
        context: '.',
        args: {
          NIX_PACKAGES: 'git',
        },
      },
    }

    await devcontainerManager.createTemplate('minimal', config)
  })

  it('should create and approve request', async () => {
    const session = await sessionManager.createSession({ name: 'request-test', repos: [] })
    const request = await requestManager.createRequest({
      sessionId: session.id,
      requestedBy: 'tester',
      changes: { addNixPackages: ['curl'] },
    })

    expect(request.status).toBe('pending')
    await requestManager.approveRequest(request.id)

    const stored = requestManager.getRequest(request.id)
    expect(stored?.status).toBe('approved')
  })

  it('should apply request and mark session stale', async () => {
    const session = await sessionManager.createSession({ name: 'request-test', repos: [] })
    const request = await requestManager.createRequest({
      sessionId: session.id,
      requestedBy: 'tester',
      changes: { addNixPackages: ['curl'] },
      action: 'modify',
    })

    await requestManager.approveRequest(request.id)
    await requestManager.applyRequest(request.id)

    const updated = await sessionManager.getSession(session.id)
    expect(updated?.status).toBe('stale')
  })
})
