import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodeServerManager } from '../../src/services/code-server-manager'
import type { DevcontainerTemplate, Session } from '@opencode-manager/shared'
import { mkdir, writeFile, chmod } from 'fs/promises'

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}))

describe('CodeServerManager', () => {
  let manager: CodeServerManager
  let session: Session
  let template: DevcontainerTemplate

  beforeEach(() => {
    manager = new CodeServerManager()
    session = {
      id: 'session-1',
      name: 'session-1',
      status: 'creating',
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
    }
    template = {
      name: 'minimal',
      config: {
        name: 'minimal',
        build: {
          dockerfile: 'Dockerfile.nix',
          context: '.',
          args: {
            NIX_PACKAGES: 'git',
          },
        },
        customizations: {
          vscode: {
            extensions: ['ms-azuretools.vscode-docker', 'esbenp.prettier-vscode'],
          },
        },
      },
      isBuiltIn: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    vi.clearAllMocks()
  })

  it('should write code-server config and scripts', async () => {
    await manager.prepareSession(session, template)

    expect(mkdir).toHaveBeenCalledWith('/workspace/sessions/session-1/code-server', { recursive: true })
    expect(writeFile).toHaveBeenCalledWith(
      '/workspace/sessions/session-1/code-server/extensions.txt',
      'ms-azuretools.vscode-docker\nesbenp.prettier-vscode',
      'utf-8'
    )
    expect(writeFile).toHaveBeenCalledWith(
      '/workspace/sessions/session-1/code-server/config.yaml',
      expect.stringContaining('bind-addr: 0.0.0.0:8080'),
      'utf-8'
    )
    expect(writeFile).toHaveBeenCalledWith(
      '/workspace/sessions/session-1/code-server/start.sh',
      expect.stringContaining('code-server --config /workspace/code-server/config.yaml /workspace'),
      'utf-8'
    )
    expect(chmod).toHaveBeenCalledWith('/workspace/sessions/session-1/code-server/start.sh', 0o755)
  })
})
