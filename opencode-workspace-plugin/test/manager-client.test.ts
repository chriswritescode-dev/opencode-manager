import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ManagerClient } from '../src/manager-client'

describe('ManagerClient', () => {
  const config = {
    managerUrl: 'http://localhost:5003',
    managerToken: 'test-token',
    connectionId: 'default',
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('listWorkspaces sends bearer token', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        workspaces: [
          {
            repoId: 1,
            name: 'repo-1',
            branch: 'main',
            cloneStatus: 'ready',
            directory: '/path/to/repo',
            extra: {
              repoId: 1,
              localPath: 'local/path',
              fullPath: '/full/path',
            },
          },
        ],
      }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const client = new ManagerClient(config)
    const workspaces = await client.listWorkspaces()

    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].repoId).toBe(1)

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:5003/api/internal/opencode-workspaces',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
  })

  it('listWorkspaces throws on error response', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const client = new ManagerClient(config)
    await expect(client.listWorkspaces()).rejects.toThrow('Failed to list workspaces')
  })

  it('ensureTarget sends POST request with correct URL', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        repoId: 42,
        state: 'healthy',
        openCodeUrl: '/api/opencode-targets/repo/42',
        headers: { Authorization: 'Bearer target-token' },
        reused: false,
      }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const client = new ManagerClient(config)
    const result = await client.ensureTarget(42)

    expect(result.repoId).toBe(42)
    expect(result.openCodeUrl).toBe('/api/opencode-targets/repo/42')
    expect(result.headers).toEqual({ Authorization: 'Bearer target-token' })

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:5003/api/internal/repos/42/opencode-target',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      }),
    )
  })

  it('ensureTarget throws on error response', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const client = new ManagerClient(config)
    await expect(client.ensureTarget(999)).rejects.toThrow('Failed to ensure target')
  })
})
