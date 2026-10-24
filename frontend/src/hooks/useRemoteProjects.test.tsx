import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeProject } from '@/api/opencode'
import { useRemoteProjects } from './useRemoteProjects'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  useOpenCodeServers: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, listProjects: mocks.listProjects }
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
  })

  it('lists the projects of the linked server, most recently active first', async () => {
    const stale = createProject('stale', { created: 1, updated: 500, active: 100 })
    const recent = createProject('recent', { created: 1, updated: 100, active: 900 })
    mocks.listProjects.mockResolvedValue([stale, recent])

    const { result } = renderHook(() => useRemoteProjects('srv_kitchen'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(2))
    expect(result.current.projects.map((project) => project.id)).toEqual(['recent', 'stale'])
    expect(mocks.listProjects).toHaveBeenCalledWith('srv_kitchen')
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
