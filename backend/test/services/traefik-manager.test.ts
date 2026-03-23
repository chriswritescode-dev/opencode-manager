import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TraefikManager } from '../../src/services/traefik-manager'
import type { Session } from '@opencode-manager/shared'
import { mkdir, writeFile, chmod } from 'fs/promises'
import { execCommand } from '../../src/utils/process'

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/utils/process', () => ({
  execCommand: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getConfigPath: () => '/workspace/config',
}))

describe('TraefikManager', () => {
  let manager: TraefikManager

  beforeEach(() => {
    manager = new TraefikManager()
    vi.clearAllMocks()
  })

  it('should write config and start container', async () => {
    vi.mocked(execCommand).mockImplementation(async (args: string[]) => {
      if (args[0] === 'docker' && args[1] === 'network') {
        return { exitCode: 0, stdout: '' }
      }
      if (args[0] === 'docker' && args[1] === 'ps') {
        return { exitCode: 0, stdout: '' }
      }
      return ''
    })

    await manager.ensureTraefik()

    expect(mkdir).toHaveBeenCalledWith('/workspace/config/traefik/dynamic', { recursive: true })
    expect(writeFile).toHaveBeenCalledWith('/workspace/config/traefik/acme.json', '{}', 'utf-8')
    expect(chmod).toHaveBeenCalledWith('/workspace/config/traefik/acme.json', 0o600)
    expect(execCommand).toHaveBeenCalledWith(
      expect.arrayContaining(['docker', 'run', '-d', '--name', 'opencode-traefik']),
    )
  })

  it('should generate dynamic routes for public sessions', async () => {
    const sessions: Session[] = [
      {
        id: 'session-1',
        name: 'session-1',
        status: 'running',
        repoMappings: [],
        opencodeContainerId: null,
        dindContainerId: null,
        codeServerContainerId: null,
        internalHostname: 'session-1.internal',
        opencodeUrl: 'http://session-1.internal:5551',
        codeServerUrl: 'http://session-1.internal:8080',
        publicOpencodeUrl: 'https://session-1.localhost',
        sessionPath: '/workspace/sessions/session-1',
        opencodeStatePath: '/workspace/sessions/session-1/opencode',
        dindDataPath: '/workspace/sessions/session-1/dind',
        codeServerConfigPath: '/workspace/sessions/session-1/code-server',
        devcontainerTemplate: 'minimal',
        devcontainerConfigHash: 'hash',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      },
    ]

    await manager.syncRoutes(sessions)

    expect(writeFile).toHaveBeenCalledWith(
      '/workspace/config/traefik/dynamic/sessions.yml',
      expect.stringContaining('session-1.localhost'),
      'utf-8'
    )
  })
})
