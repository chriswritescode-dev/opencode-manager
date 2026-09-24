import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { useDeleteSession, useSession, useSessionsAcrossDirectories } from './useOpenCode'
import { FetchError } from '../api/fetchWrapper'

const mocks = vi.hoisted(() => ({
  listSessionPage: vi.fn(),
  deleteSession: vi.fn(),
}))

vi.mock('../lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return {
    ...actual,
    listSessionPage: mocks.listSessionPage,
    deleteSession: mocks.deleteSession,
  }
})

const sessionInfo = (id: string, directory: string, updated = 1000): SessionInfo => ({
  id,
  projectID: 'proj_1',
  title: `Session ${id}`,
  time: { created: 1000, updated },
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const createQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

describe('useSessionsAcrossDirectories', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    mocks.listSessionPage.mockReset()
    mocks.deleteSession.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pages sessions across two directories through the V2 facade', async () => {
    mocks.listSessionPage.mockImplementation(async ({ directory, cursor }: { directory: string; cursor?: string }) => {
      if (cursor === 'cursor_a') {
        return { items: [sessionInfo('ses_a2', '/w/a', 2000)] }
      }
      return directory === '/w/a'
        ? { items: [sessionInfo('ses_a1', '/w/a')], nextCursor: 'cursor_a' }
        : { items: [sessionInfo('ses_b1', '/w/b')] }
    })

    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useSessionsAcrossDirectories(['/w/a', '/w/b']),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1', 'ses_b1'])
    expect(result.current.hasNextPage).toBe(true)
    expect(mocks.listSessionPage).toHaveBeenCalledWith({
      directory: '/w/a',
      limit: 25,
      order: 'desc',
      search: undefined,
    })
    expect(mocks.listSessionPage).toHaveBeenCalledWith({
      directory: '/w/b',
      limit: 25,
      order: 'desc',
      search: undefined,
    })

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    expect(mocks.listSessionPage).toHaveBeenCalledWith({ directory: '/w/a', cursor: 'cursor_a' })
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1', 'ses_b1', 'ses_a2'])
  })

  it('passes the trimmed search to every directory page', async () => {
    mocks.listSessionPage.mockResolvedValue({ items: [] })

    const queryClient = createQueryClient()
    renderHook(
      () => useSessionsAcrossDirectories(['/w/a'], { search: '  deploy  ' }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(mocks.listSessionPage).toHaveBeenCalledWith({
        directory: '/w/a',
        limit: 25,
        order: 'desc',
        search: 'deploy',
      })
    })
  })

  it('deletes each session through the facade and invalidates the session list cache', async () => {
    mocks.deleteSession.mockResolvedValue(undefined)

    const queryClient = createQueryClient()
    const listKey = ['opencode', 'sessions', '/w/a', { search: undefined, limit: 25 }]
    queryClient.setQueryData(listKey, { pages: [{ items: [], cursors: {} }], pageParams: [undefined] })

    const { result } = renderHook(() => useDeleteSession(['/w/a']), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: 'ses_a1', directory: '/w/a' })
    })

    expect(mocks.deleteSession).toHaveBeenCalledWith('ses_a1')
    await waitFor(() => {
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
    })
  })
})

describe('useSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps a deleted session to a non-retried 404 through the real facade', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          _tag: 'SessionNotFoundError',
          sessionID: 'ses_missing',
          message: 'Session not found',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useSession('ses_missing', '/w/a'), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(FetchError)
    expect((result.current.error as FetchError).statusCode).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
