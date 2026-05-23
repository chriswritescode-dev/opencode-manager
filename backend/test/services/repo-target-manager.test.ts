import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
const netCreateServerMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('net', () => ({
  createServer: netCreateServerMock,
}))

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/test/workspace'),
  getOpenCodeConfigFilePath: vi.fn(() => '/test/workspace/.config/opencode.json'),
  ENV: {
    SERVER: { NODE_ENV: 'test' },
    AUTH: { SECRET: 'test-secret-for-hmac' },
    OPENCODE: {
      PORT: 5551,
      HOST: '127.0.0.1',
      SERVER_PASSWORD: '',
      SERVER_USERNAME: 'opencode',
    },
    WORKSPACE: {
      BASE_PATH: '/test/workspace',
      REPOS_DIR: 'repos',
      CONFIG_DIR: 'config',
    },
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../src/services/opencode/repo-target-token', () => ({
  createRepoTargetToken: vi.fn((repoId: number) => `tok-${repoId}:abc:signature`),
  verifyRepoTargetToken: vi.fn((token: string) => {
    const parts = token.split(':')
    if (parts.length === 3) {
      return { repoId: parseInt(parts[0]!, 10) }
    }
    return null
  }),
}))

import { RepoOpenCodeTargetManager } from '../../src/services/opencode/repo-target-manager'
import type { Repo } from '../../src/types/repo'

function createMockRepo(id: number, fullPath: string = `/test/repos/${id}`): Repo {
  return {
    id,
    localPath: `repos/${id}`,
    fullPath,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
    isWorktree: false,
  } as Repo
}

function createMockSpawn(pid = 1234) {
  spawnMock.mockReturnValue({
    pid,
    stderr: { on: vi.fn() },
    on: vi.fn(),
  })
}

function setupPortAllocation(port: number) {
  const mockServer = {
    listen: vi.fn((_port: number, _host: string, cb: () => void) => {
      cb()
    }),
    address: vi.fn(() => ({ port })),
    close: vi.fn((cb: () => void) => cb()),
    on: vi.fn(),
  }
  netCreateServerMock.mockReturnValue(mockServer)
}

describe('RepoOpenCodeTargetManager', () => {
  let manager: RepoOpenCodeTargetManager
  let killSpy: ReturnType<typeof vi.fn>
  const originalKill = process.kill

  beforeEach(() => {
    vi.clearAllMocks()
    setupPortAllocation(15000)
    manager = new RepoOpenCodeTargetManager()
    killSpy = vi.fn()
    process.kill = killSpy
  })

  afterEach(() => {
    process.kill = originalKill
    delete (globalThis as any).fetch
  })

  describe('ensureTarget', () => {
    it('starts a new target process and returns healthy response', async () => {
      createMockSpawn(1001)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any

      const result = await manager.ensureTarget(createMockRepo(42))

      expect(result.repoId).toBe(42)
      expect(result.state).toBe('healthy')
      expect(result.openCodeUrl).toBe('/api/opencode-targets/repo/42')
      expect(result.reused).toBe(false)
      expect(result.headers).toHaveProperty('Authorization')
      expect(spawnMock).toHaveBeenCalledWith(
        'opencode',
        ['serve', '--port', '15000', '--hostname', '127.0.0.1'],
        expect.objectContaining({
          cwd: '/test/repos/42',
          env: expect.objectContaining({
            XDG_DATA_HOME: '/test/workspace/opencode-targets/repo-42/state',
            XDG_STATE_HOME: '/test/workspace/opencode-targets/repo-42/state',
            XDG_CONFIG_HOME: '/test/workspace/opencode-targets/repo-42/config',
            OPENCODE_CONFIG: '/test/workspace/.config/opencode.json',
          })
        })
      )
    })

    it('reuses an existing healthy target', async () => {
      createMockSpawn(1001)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any

      await manager.ensureTarget(createMockRepo(42))
      const result2 = await manager.ensureTarget(createMockRepo(42))

      expect(result2.reused).toBe(true)
      expect(result2.state).toBe('healthy')
      expect(result2.openCodeUrl).toBe('/api/opencode-targets/repo/42')
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    it('restarts an unhealthy target', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn(async () => {
        callCount++
        if (callCount <= 1) {
          return new Response(null, { status: 200 })
        }
        return new Response(null, { status: 503 })
      }) as any

      createMockSpawn(1001)
      const result1 = await manager.ensureTarget(createMockRepo(42))
      expect(result1.state).toBe('healthy')

      createMockSpawn(1002)

      callCount = 0
      let secondCallHealthCount = 0
      globalThis.fetch = vi.fn(async () => {
        secondCallHealthCount++
        if (secondCallHealthCount <= 1) {
          return new Response(null, { status: 503 })
        }
        return new Response(null, { status: 200 })
      }) as any

      const result2 = await manager.ensureTarget(createMockRepo(42))
      expect(result2.reused).toBe(false)
      expect(result2.state).toBe('healthy')
      expect(spawnMock).toHaveBeenCalledTimes(2)
    })

    it('creates state and config directories', async () => {
      createMockSpawn(1001)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any
      const { promises: fs } = await import('fs')

      await manager.ensureTarget(createMockRepo(42))

      expect(fs.mkdir).toHaveBeenCalledWith('/test/workspace/opencode-targets/repo-42/state', { recursive: true })
      expect(fs.mkdir).toHaveBeenCalledWith('/test/workspace/opencode-targets/repo-42/config', { recursive: true })
    })

    it('kills failed startup process before restart', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      const spawnCalls: { pid: number; args: string[] }[] = []
      spawnMock.mockImplementation((cmd: string, args: string[]) => {
        const pid = 1000 + spawnCalls.length
        spawnCalls.push({ pid, args })
        return {
          pid,
          stderr: { on: vi.fn() },
          on: vi.fn(),
        }
      })

      globalThis.fetch = vi.fn(async () => new Response(null, { status: 503 })) as any

      const promise1 = manager.ensureTarget(createMockRepo(42))

      await vi.advanceTimersByTimeAsync(31000)

      const result1 = await promise1
      expect(result1.state).toBe('failed')
      expect(killSpy).toHaveBeenCalledWith(1000, 'SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(1000, 'SIGKILL')

      const runtime = manager.getTarget(42)
      expect(runtime!.process).toBeNull()
      expect(runtime!.state).toBe('failed')
      expect(spawnMock).toHaveBeenCalledTimes(1)

      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any

      const promise2 = manager.ensureTarget(createMockRepo(42))
      await vi.advanceTimersByTimeAsync(2100)
      const result2 = await promise2
      expect(result2.state).toBe('healthy')
      expect(result2.reused).toBe(false)
      expect(spawnMock).toHaveBeenCalledTimes(2)

      const { promises: fs } = await import('fs')
      expect(fs.mkdir).toHaveBeenCalledWith('/test/workspace/opencode-targets/repo-42/state', { recursive: true })
      expect(fs.mkdir).toHaveBeenCalledWith('/test/workspace/opencode-targets/repo-42/config', { recursive: true })

      vi.useRealTimers()
    })
  })

  describe('getTarget', () => {
    it('returns null for unknown repo', () => {
      expect(manager.getTarget(99)).toBeNull()
    })

    it('returns runtime after ensureTarget', async () => {
      createMockSpawn(1001)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any
      await manager.ensureTarget(createMockRepo(42))

      const runtime = manager.getTarget(42)
      expect(runtime).not.toBeNull()
      expect(runtime!.repoId).toBe(42)
      expect(runtime!.state).toBe('healthy')
      expect(runtime!.port).toBe(15000)
    })
  })

  describe('stopTarget', () => {
    it('stops an existing target', async () => {
      createMockSpawn(1001)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any
      await manager.ensureTarget(createMockRepo(42))

      await manager.stopTarget(42, 'manual')

      const runtime = manager.getTarget(42)
      expect(runtime!.state).toBe('stopped')
      expect(runtime!.process).toBeNull()
    })

    it('does nothing for unknown repo', async () => {
      await manager.stopTarget(99, 'idle')
    })

    it('deletes target on shutdown', async () => {
      createMockSpawn(1001)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any
      await manager.ensureTarget(createMockRepo(42))

      await manager.stopTarget(42, 'shutdown')

      expect(manager.getTarget(42)).toBeNull()
    })

    it('sends SIGTERM then SIGKILL to process', async () => {
      createMockSpawn(1234)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any

      await manager.ensureTarget(createMockRepo(42))

      await manager.stopTarget(42, 'manual')

      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGKILL')
    })
  })

  describe('health check authentication', () => {
    it('sends Basic auth header with health checks', async () => {
      createMockSpawn(1001)
      const fetchCalls: { url: string; headers: Record<string, string> }[] = []
      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const requestUrl = typeof url === 'string' ? url : url.toString()
        fetchCalls.push({
          url: requestUrl,
          headers: (init?.headers as Record<string, string>) ?? {}
        })
        return new Response(null, { status: 200 })
      }) as any

      await manager.ensureTarget(createMockRepo(42))

      const healthCheckCalls = fetchCalls.filter(r => r.url.includes('/doc'))
      expect(healthCheckCalls.length).toBeGreaterThan(0)
      
      for (const call of healthCheckCalls) {
        expect(call.headers.Authorization).toMatch(/^Basic /)
      }
    })
  })

  describe('concurrency guard', () => {
    it('handles multiple ensureTarget calls for different repos', async () => {
      createMockSpawn(1001)
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any

      const [r1, r2] = await Promise.all([
        manager.ensureTarget(createMockRepo(1)),
        manager.ensureTarget(createMockRepo(2)),
      ])

      expect(r1.repoId).toBe(1)
      expect(r2.repoId).toBe(2)
      expect(spawnMock).toHaveBeenCalledTimes(2)
    })

    it('prevents duplicate process spawning for concurrent same-repo calls', async () => {
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any

      createMockSpawn(1001)

      const [result1, result2] = await Promise.all([
        manager.ensureTarget(createMockRepo(42)),
        manager.ensureTarget(createMockRepo(42)),
      ])

      expect(result1.repoId).toBe(42)
      expect(result2.repoId).toBe(42)
      expect(result1.state).toBe('healthy')
      expect(result2.state).toBe('healthy')
      expect(result1.openCodeUrl).toBe('/api/opencode-targets/repo/42')
      expect(result2.openCodeUrl).toBe('/api/opencode-targets/repo/42')
      
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })
  })
})
