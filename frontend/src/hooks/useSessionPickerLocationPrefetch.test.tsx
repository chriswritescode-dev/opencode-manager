import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo } from '@/api/types'
import { openCodeLocationQueryOptions } from '@/lib/openCodeLocation'
import { useSessionPickerLocationPrefetch } from './useSessionPickerLocationPrefetch'

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  getOpenCodeLocation: vi.fn(),
}))

vi.mock('@/api/repos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/repos')>()
  return {
    ...actual,
    listRepos: mocks.listRepos,
  }
})

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return {
    ...actual,
    getOpenCodeLocation: mocks.getOpenCodeLocation,
  }
})

const REPO_PATH = '/repo'
const LOCATION = { directory: REPO_PATH, projectID: 'proj_1', worktree: REPO_PATH }

const repo: Repo = {
  id: 1,
  fullPath: REPO_PATH,
  localPath: REPO_PATH,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/1/sessions/session-1']}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('useSessionPickerLocationPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOpenCodeLocation.mockResolvedValue(LOCATION)
  })

  afterEach(() => {
    mocks.listRepos.mockReset()
  })

  it('prefetches the location once repos data arrives after mount', async () => {
    let resolveRepos: (repos: Repo[]) => void = () => {}
    mocks.listRepos.mockImplementation(
      () => new Promise<Repo[]>((resolve) => {
        resolveRepos = resolve
      }),
    )
    const queryClient = createQueryClient()

    renderHook(() => useSessionPickerLocationPrefetch(), {
      wrapper: createWrapper(queryClient),
    })

    expect(mocks.getOpenCodeLocation).not.toHaveBeenCalled()

    await act(async () => {
      resolveRepos([repo])
    })

    await waitFor(() => {
      expect(mocks.getOpenCodeLocation).toHaveBeenCalledWith(REPO_PATH, LOCAL_OPENCODE_SERVER_ID)
    })

    const locationQuery = queryClient
      .getQueryCache()
      .find({ queryKey: openCodeLocationQueryOptions(REPO_PATH, LOCAL_OPENCODE_SERVER_ID).queryKey })
    expect(locationQuery?.observers.length).toBe(0)
  })

  it('prefetches the location when repos data is already cached', async () => {
    mocks.listRepos.mockResolvedValue([repo])
    const queryClient = createQueryClient()
    queryClient.setQueryData<Repo[]>(['repos'], [repo])

    renderHook(() => useSessionPickerLocationPrefetch(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(mocks.getOpenCodeLocation).toHaveBeenCalledWith(REPO_PATH, LOCAL_OPENCODE_SERVER_ID)
    })
  })

  it('does not prefetch when the route has no repo', async () => {
    mocks.listRepos.mockResolvedValue([repo])
    const queryClient = createQueryClient()
    queryClient.setQueryData<Repo[]>(['repos'], [repo])

    renderHook(() => useSessionPickerLocationPrefetch(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/sessions/session-1']}>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    })

    await waitFor(() => {
      expect(mocks.listRepos).toHaveBeenCalled()
    })

    expect(mocks.getOpenCodeLocation).not.toHaveBeenCalled()
  })
})
