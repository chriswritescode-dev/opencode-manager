import { describe, it, expect, vi } from 'vitest'
import { DockerOrchestrator } from '../../src/services/docker-orchestrator'

vi.mock('dockerode', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      listContainers: vi.fn(),
      getContainer: vi.fn(),
    })),
  }
})

describe('DockerOrchestrator', () => {
  it('should include repo mounts and template context', async () => {
    const orchestrator = new DockerOrchestrator()

    const compose = await (orchestrator as any).generateComposeFile({
      sessionName: 'test-session',
      sessionPath: '/workspace/sessions/test-session',
      nixPackages: 'git',
      configHash: 'hash123',
      publicDomain: 'localhost',
      devcontainerTemplate: 'minimal',
    })

    expect(compose).toContain('context: /workspace/devcontainers/minimal')
    expect(compose).toContain('- /workspace/repos:/workspace/repos')
    expect(compose).toContain('- /workspace/repos:/workspace-root/repos')
  })

  it('should use image when imageId provided', async () => {
    const orchestrator = new DockerOrchestrator()

    const compose = await (orchestrator as any).generateComposeFile({
      sessionName: 'test-session',
      sessionPath: '/workspace/sessions/test-session',
      nixPackages: 'git',
      configHash: 'hash123',
      publicDomain: 'localhost',
      devcontainerTemplate: 'minimal',
      imageId: 'opencode-session:minimal-hash123',
    })

    expect(compose).toContain('image: opencode-session:minimal-hash123')
  })

  it('should include health and uptime in container status', async () => {
    const orchestrator = new DockerOrchestrator()
    const docker = (orchestrator as any).docker

    docker.listContainers.mockResolvedValue([
      {
        Id: 'abc',
        Names: ['/test-opencode'],
        State: 'running',
        Status: 'Up 1 minute (healthy)',
      },
    ])

    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        State: {
          Health: { Status: 'healthy' },
          StartedAt: new Date(Date.now() - 120000).toISOString(),
        },
      }),
    })

    const status = await orchestrator.getContainerStatus('test-opencode')

    expect(status?.health).toBe('healthy')
    expect(status?.uptime).toBeGreaterThanOrEqual(120)
  })

  it('should wait for containers to become healthy', async () => {
    const orchestrator = new DockerOrchestrator()
    const statusSpy = vi.spyOn(orchestrator, 'getContainerStatus')
      .mockResolvedValueOnce({ id: '1', name: 'a', state: 'running', health: 'starting' })
      .mockResolvedValueOnce({ id: '2', name: 'b', state: 'running', health: 'starting' })
      .mockResolvedValueOnce({ id: '1', name: 'a', state: 'running', health: 'healthy' })
      .mockResolvedValueOnce({ id: '2', name: 'b', state: 'running', health: 'healthy' })

    await orchestrator.waitForContainersHealthy(['a', 'b'], { timeoutMs: 50, intervalMs: 1 })

    expect(statusSpy).toHaveBeenCalled()
  })
})
