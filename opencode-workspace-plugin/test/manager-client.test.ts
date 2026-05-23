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

  it('listWorkspaces rejects with 401 Unauthorized', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const client = new ManagerClient(config)
    await expect(client.listWorkspaces()).rejects.toThrow('401 Unauthorized')
  })
})
