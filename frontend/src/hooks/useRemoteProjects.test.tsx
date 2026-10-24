import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeProject } from '@/api/opencode'
import { useRemoteProjects, useRemoteProjectsByActivity } from './useRemoteProjects'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listSessionPage: vi.fn(),
  useOpenCodeServers: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, listProjects: mocks.listProjects, listSessionPage: mocks.listSessionPage }
})

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
}))

const kitchen = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

function createProject(
  id: string,
  time: { created: number; updated: number; active?: number },
): OpenCodeProject {
  return { id, name: id, canonical: `/work/${id}`, time, sandboxes: [] }
}

function createSession(id: string, directory: string, updated: number) {
  return {
    id,
    projectID: 'prj_1',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated - 1000, updated },
    location: { directory },
  }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useRemoteProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })
    mocks.listProjects.mockResolvedValue([])
    mocks.listSessionPage.mockResolvedValue({ items: [] })
  })

  it('lists the projects of the linked server, most recently updated first', async () => {
    const stale = createProject('stale', { created: 1, updated: 900, active: 100 })
    const recent = createProject('recent', { created: 1, updated: 100, active: 900 })
    mocks.listProjects.mockResolvedValue([stale, recent])

    const { result } = renderHook(() => useRemoteProjects('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(2))
    expect(result.current.projects.map((project) => project.id)).toEqual(['stale', 'recent'])
    expect(mocks.listProjects).toHaveBeenCalledWith('srv_kitchen')
  })

  it('does not fetch sessions for the canonical project lookup', async () => {
    mocks.listProjects.mockResolvedValue([createProject('app', { created: 1, updated: 2 })])

    const { result } = renderHook(() => useRemoteProjects('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(1))
    expect(mocks.listSessionPage).not.toHaveBeenCalled()
  })

  it('stays idle while the linked server is disabled', () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...kitchen, enabled: false }],
      isLoading: false,
    })

    const { result } = renderHook(() => useRemoteProjects('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.projects).toEqual([])
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('stays idle when the caller disables it', () => {
    renderHook(() => useRemoteProjects('srv_kitchen', { enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('keeps the cached projects and reports the failure when a refetch fails', async () => {
    mocks.listProjects
      .mockResolvedValueOnce([createProject('app', { created: 1, updated: 2 })])
      .mockRejectedValueOnce(new Error('offline'))

    const { result } = renderHook(() => useRemoteProjects('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(1))

    result.current.refetch()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.hasData).toBe(true)
    expect(result.current.projects.map((project) => project.id)).toEqual(['app'])
    expect(result.current.error?.message).toBe('offline')
  })
})

describe('useRemoteProjectsByActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })
    mocks.listSessionPage.mockResolvedValue({ items: [] })
  })

  it('orders and dates projects by their newest session', async () => {
    mocks.listProjects.mockResolvedValue([
      createProject('idle', { created: 1, updated: 900, active: 999 }),
      createProject('worked', { created: 1, updated: 100, active: 999 }),
    ])
    mocks.listSessionPage.mockResolvedValue({
      items: [createSession('ses_1', '/work/worked', 500)],
    })

    const { result } = renderHook(() => useRemoteProjectsByActivity('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.activityById.get('worked')).toBe(500))
    expect(result.current.projects.map((project) => project.id)).toEqual(['worked', 'idle'])
    expect(result.current.activityById.get('idle')).toBe(900)
  })

  it('sorts a project without a session after the session-backed ones', async () => {
    mocks.listProjects.mockResolvedValue([
      createProject('quiet', { created: 1, updated: 950 }),
      createProject('worked', { created: 1, updated: 100 }),
    ])
    mocks.listSessionPage.mockResolvedValue({
      items: [createSession('ses_1', '/work/worked', 300)],
    })

    const { result } = renderHook(() => useRemoteProjectsByActivity('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.activityById.get('worked')).toBe(300))
    expect(result.current.projects.map((project) => project.id)).toEqual(['worked', 'quiet'])
  })

  it('fetches one session page per server, newest first and across every directory', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    mocks.listProjects.mockResolvedValue([
      createProject('alpha', { created: 1, updated: 10 }),
      createProject('beta', { created: 1, updated: 20 }),
      createProject('gamma', { created: 1, updated: 30 }),
    ])
    mocks.listSessionPage.mockResolvedValue({ items: [] })

    const { result } = renderHook(() => useRemoteProjectsByActivity('srv_kitchen'), { wrapper })

    await waitFor(() => expect(result.current.projects).toHaveLength(3))
    await waitFor(() => expect(mocks.listSessionPage).toHaveBeenCalledTimes(1))

    expect(mocks.listSessionPage).toHaveBeenCalledWith(
      { limit: 100, order: 'desc' },
      'srv_kitchen',
    )
  })

  it('stays idle while the linked server is disabled', () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...kitchen, enabled: false }],
      isLoading: false,
    })

    const { result } = renderHook(() => useRemoteProjectsByActivity('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    expect(result.current.projects).toEqual([])
    expect(mocks.listProjects).not.toHaveBeenCalled()
    expect(mocks.listSessionPage).not.toHaveBeenCalled()
  })
})
