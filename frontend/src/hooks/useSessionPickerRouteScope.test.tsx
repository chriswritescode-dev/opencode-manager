import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { useSessionPickerRouteScope } from './useSessionPickerRouteScope'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listProjects: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, getSession: mocks.getSession, listProjects: mocks.listProjects }
})

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: () => ({
    servers: [{ id: 'srv_kitchen', name: 'Kitchen', enabled: true }],
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useSidebarRepoGroups', () => ({
  useNavigableRepos: () => ({ repos: [], isLoading: false, refetch: vi.fn() }),
}))

function renderScope(entry: string, seed?: (queryClient: QueryClient) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed?.(queryClient)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return renderHook(() => useSessionPickerRouteScope(true), { wrapper })
}

const kitchenProject = {
  id: 'p1',
  name: 'App',
  canonical: '/home/me/app',
  time: { created: 1, updated: 2 },
  sandboxes: [],
}

describe('useSessionPickerRouteScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.listProjects.mockResolvedValue([])
  })

  it('resolves a session subdirectory to the canonical directory of its project', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'ses_remote',
      location: { directory: '/home/me/app/packages/web' },
    })
    mocks.listProjects.mockResolvedValue([kitchenProject])

    const { result } = renderScope('/servers/srv_kitchen/sessions/ses_remote')

    await waitFor(() => expect(result.current.remote?.projectDirectory).toBe('/home/me/app'))
    expect(result.current.remote?.isPending).toBe(false)
    expect(result.current.remote?.serverName).toBe('Kitchen')
    expect(result.current.activeSessionID).toBe('ses_remote')
  })

  it('falls back to the session directory when no project owns it', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'ses_remote',
      location: { directory: '/home/me/other' },
    })

    const { result } = renderScope('/servers/srv_kitchen/sessions/ses_remote')

    await waitFor(() => expect(result.current.remote?.projectDirectory).toBe('/home/me/other'))
    expect(result.current.remote?.isPending).toBe(false)
  })

  it('reports the scope as pending while the session directory resolves', async () => {
    mocks.getSession.mockReturnValue(new Promise(() => undefined))

    const { result } = renderScope('/servers/srv_kitchen/sessions/ses_remote')

    await waitFor(() => expect(result.current.remote?.isPending).toBe(true))
    expect(result.current.remote?.projectDirectory).toBeUndefined()
  })

  it('reuses the session the open page already loaded', async () => {
    mocks.getSession.mockReturnValue(new Promise(() => undefined))
    mocks.listProjects.mockResolvedValue([kitchenProject])

    const { result } = renderScope('/servers/srv_kitchen/sessions/ses_remote', (queryClient) => {
      queryClient.setQueryData(
        ['opencode', 'session', 'ses_remote', '/home/me/app/packages/web', 'srv_kitchen'],
        { id: 'ses_remote', location: { directory: '/home/me/app/packages/web' } },
      )
    })

    await waitFor(() => expect(result.current.remote?.projectDirectory).toBe('/home/me/app'))
    expect(result.current.remote?.isPending).toBe(false)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('scopes to the whole server on a route without a session', () => {
    const { result } = renderScope('/')

    expect(result.current.remote?.projectDirectory).toBeUndefined()
    expect(result.current.remote?.isPending).toBe(false)
    expect(result.current.activeSessionID).toBeUndefined()
  })

  it('resolves no linked-server scope for the local server', () => {
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })

    const { result } = renderScope('/repos/5/sessions/ses_local')

    expect(result.current.remote).toBeUndefined()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })
})
