import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createManagerWorkspaceAdapter } from '../src/adapter'
import type { ManagerClient } from '../src/manager-client'
import type { PluginConfig } from '../src/config'
import type { PluginInput } from '../src/opencode-plugin-types'

describe('createManagerWorkspaceAdapter', () => {
  const config: PluginConfig = {
    managerUrl: 'http://localhost:5003',
    managerToken: 'test-token',
    connectionId: 'default',
  }

  const mockInput: PluginInput = {
    experimental_workspace: {
      register: vi.fn(),
    },
    project: {
      id: 'project-1',
    },
    serverUrl: new URL('http://localhost:5551'),
  }

  let mockClient: ManagerClient

  beforeEach(() => {
    vi.restoreAllMocks()
    mockClient = {
      listWorkspaces: vi.fn(),
      ensureTarget: vi.fn(),
    } as unknown as ManagerClient
  })

  it('registers with type manager', () => {
    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    expect(adapter.name).toBe('manager')
  })

  it('list maps Manager workspaces to OpenCode listed workspaces', async () => {
    vi.mocked(mockClient.listWorkspaces).mockResolvedValue([
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
    ])

    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    const result = await adapter.list!()

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('manager')
    expect(result[0].name).toBe('manager:default:1:local/path')
    expect(result[0].branch).toBe('main')
    expect(result[0].directory).toBeNull()
    expect(result[0].projectID).toBe('project-1')
    expect(result[0].extra).toEqual({
      repoId: 1,
      managerUrl: 'http://localhost:5003',
      connectionId: 'default',
      localPath: 'local/path',
      fullPath: '/full/path',
    })
  })

  it('configure validates metadata', async () => {
    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)

    await expect(
      adapter.configure({
        id: 'test',
        type: 'manager',
        name: 'test',
        branch: null,
        directory: null,
        extra: null,
        projectID: 'project-1',
      }),
    ).rejects.toThrow('Missing extra metadata')

    await expect(
      adapter.configure({
        id: 'test',
        type: 'manager',
        name: 'test',
        branch: null,
        directory: null,
        extra: { notRepoId: true },
        projectID: 'project-1',
      }),
    ).rejects.toThrow('Missing or invalid repoId')
  })

  it('configure accepts valid metadata', async () => {
    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    const result = await adapter.configure({
      id: 'test',
      type: 'manager',
      name: 'test',
      branch: null,
      directory: null,
      extra: { repoId: 42 },
      projectID: 'project-1',
    })
    expect(result.extra).toEqual({ repoId: 42 })
  })

  it('target returns Manager reverse-proxy URL and headers', async () => {
    vi.mocked(mockClient.ensureTarget).mockResolvedValue({
      repoId: 42,
      state: 'healthy',
      openCodeUrl: '/api/opencode-targets/repo/42',
      headers: { Authorization: 'Bearer target-token' },
      reused: false,
    })

    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    const result = await adapter.target({
      id: 'test',
      type: 'manager',
      name: 'test',
      branch: null,
      directory: null,
      extra: { repoId: 42 },
      projectID: 'project-1',
    })

    expect(result.type).toBe('remote')
    if (result.type === 'remote') {
      expect(result.url.toString()).toContain('/api/opencode-targets/repo/42')
      expect(result.headers).toEqual({ Authorization: 'Bearer target-token' })
    }
  })

  it('target throws on invalid repoId', async () => {
    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    await expect(
      adapter.target({
        id: 'test',
        type: 'manager',
        name: 'test',
        branch: null,
        directory: null,
        extra: { wrongField: true },
        projectID: 'project-1',
      }),
    ).rejects.toThrow('Invalid workspace: missing repoId')
  })

  it('target throws on missing extra', async () => {
    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    await expect(
      adapter.target({
        id: 'test',
        type: 'manager',
        name: 'test',
        branch: null,
        directory: null,
        extra: null,
        projectID: 'project-1',
      }),
    ).rejects.toThrow('Invalid workspace: missing repoId')
  })

  it('create is a no-op', async () => {
    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    await expect(
      adapter.create({
        id: 'test',
        type: 'manager',
        name: 'test',
        branch: null,
        directory: null,
        extra: null,
        projectID: 'project-1',
      }, {}),
    ).resolves.toBeUndefined()
  })

  it('remove is a no-op', async () => {
    const adapter = createManagerWorkspaceAdapter(mockInput, config, mockClient)
    await expect(
      adapter.remove({
        id: 'test',
        type: 'manager',
        name: 'test',
        branch: null,
        directory: null,
        extra: null,
        projectID: 'project-1',
      }),
    ).resolves.toBeUndefined()
  })
})
