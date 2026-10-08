import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { useChildSessionReconciliation, useCreateSession, useDeleteSession, useSession, useSessionsAcrossDirectories } from './useOpenCode'
import { FetchError } from '../api/fetchWrapper'
import { showToast } from '../lib/toast'
import { useSessionStatus } from '../stores/sessionStatusStore'

const mocks = vi.hoisted(() => ({
  listSessionPage: vi.fn(),
  deleteSession: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('../lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  mocks.getSession.mockImplementation(actual.getSession)
  return {
    ...actual,
    listSessionPage: mocks.listSessionPage,
    deleteSession: mocks.deleteSession,
    createSession: mocks.createSession,
    getSession: mocks.getSession,
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

  it('issues one call per page across all directories and paginates by cursor', async () => {
    mocks.listSessionPage.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      if (cursor === 'cursor_all') {
        return { items: [sessionInfo('ses_all2', '/w/b', 2000)] }
      }
      return { items: [sessionInfo('ses_all1', '/w/a')], nextCursor: 'cursor_all' }
    })

    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useSessionsAcrossDirectories(['/w/a', '/w/b'], { allDirectories: true }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mocks.listSessionPage).toHaveBeenCalledTimes(1)
    expect(mocks.listSessionPage).toHaveBeenCalledWith({
      limit: 25,
      order: 'desc',
      search: undefined,
    })
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_all1'])
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    expect(mocks.listSessionPage).toHaveBeenCalledTimes(2)
    expect(mocks.listSessionPage).toHaveBeenLastCalledWith({ cursor: 'cursor_all' })
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_all1', 'ses_all2'])
  })

  it('deletes each session through the facade and removes it from cached lists without invalidating', async () => {
    mocks.deleteSession.mockResolvedValue(undefined)

    const queryClient = createQueryClient()
    const listKey = ['opencode', 'sessions', '/w/a', { search: undefined, limit: 25, allDirectories: false }]
    queryClient.setQueryData(listKey, {
      pages: [{
        items: [sessionInfo('ses_a1', '/w/a'), sessionInfo('ses_a2', '/w/a')],
        nextParam: undefined,
      }],
      pageParams: [undefined],
    })

    const { result } = renderHook(() => useDeleteSession(['/w/a']), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: 'ses_a1', directory: '/w/a' })
    })

    expect(mocks.deleteSession).toHaveBeenCalledWith('ses_a1')
    const cached = queryClient.getQueryData<{ pages: Array<{ items: SessionInfo[] }> }>(listKey)
    expect(cached?.pages[0].items.map((session) => session.id)).toEqual(['ses_a2'])
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
  })

  it('invalidates the session list cache when a delete fails', async () => {
    mocks.deleteSession.mockRejectedValue(new Error('nope'))

    const queryClient = createQueryClient()
    const listKey = ['opencode', 'sessions', '/w/a', { search: undefined, limit: 25, allDirectories: false }]
    queryClient.setQueryData(listKey, {
      pages: [{ items: [sessionInfo('ses_a1', '/w/a')], nextParam: undefined }],
      pageParams: [undefined],
    })

    const { result } = renderHook(() => useDeleteSession(['/w/a']), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'ses_a1', directory: '/w/a' }),
      ).rejects.toThrow('Failed to delete 1 session(s)')
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
    })
  })

  it('does not keep previous results across a search change unless requested', async () => {
    let resolveSearch: ((value: { items: SessionInfo[] }) => void) | undefined
    mocks.listSessionPage.mockImplementation(({ search }: { search?: string }) => {
      if (search === 'deploy') {
        return new Promise<{ items: SessionInfo[] }>((resolve) => { resolveSearch = resolve })
      }
      return Promise.resolve({ items: [sessionInfo('ses_a1', '/w/a')] })
    })

    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      (props: { search?: string }) => useSessionsAcrossDirectories(['/w/a'], { search: props.search }),
      { wrapper: createWrapper(queryClient), initialProps: { search: undefined as string | undefined } },
    )

    await waitFor(() => {
      expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1'])
    })

    rerender({ search: 'deploy' })

    await waitFor(() => expect(resolveSearch).toBeDefined())

    expect(result.current.isPlaceholderData).toBe(false)
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toHaveLength(0)

    await act(async () => {
      resolveSearch?.({ items: [sessionInfo('ses_b1', '/w/a')] })
    })

    await waitFor(() => {
      expect(result.current.data.map((session) => session.id)).toEqual(['ses_b1'])
    })
  })

  it('keeps previous results across a search change when requested', async () => {
    let resolveSearch: ((value: { items: SessionInfo[] }) => void) | undefined
    mocks.listSessionPage.mockImplementation(({ search }: { search?: string }) => {
      if (search === 'deploy') {
        return new Promise<{ items: SessionInfo[] }>((resolve) => { resolveSearch = resolve })
      }
      return Promise.resolve({ items: [sessionInfo('ses_a1', '/w/a')] })
    })

    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      (props: { search?: string; keepPreviousResults?: boolean }) =>
        useSessionsAcrossDirectories(['/w/a'], {
          search: props.search,
          keepPreviousResults: props.keepPreviousResults,
        }),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { search: undefined as string | undefined, keepPreviousResults: true },
      },
    )

    await waitFor(() => {
      expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1'])
    })

    rerender({ search: 'deploy', keepPreviousResults: true })

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true))
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1'])

    await act(async () => {
      resolveSearch?.({ items: [sessionInfo('ses_b1', '/w/a')] })
    })

    await waitFor(() => {
      expect(result.current.data.map((session) => session.id)).toEqual(['ses_b1'])
    })
    expect(result.current.isPlaceholderData).toBe(false)
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

describe('useCreateSession', () => {
  beforeEach(() => {
    mocks.createSession.mockReset()
    mocks.createSession.mockResolvedValue(sessionInfo('ses_new', '/w/a'))
  })

  it('refuses to create a session without a directory and reports the error', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useCreateSession(undefined), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await expect(result.current.mutateAsync({ agent: undefined })).rejects.toThrow(
        'A directory is required to create a session',
      )
    })

    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(showToast.error).toHaveBeenCalled()
  })

  it('creates a session in the provided directory', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useCreateSession('/w/a'), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ agent: undefined })
    })

    expect(mocks.createSession).toHaveBeenCalledWith({ directory: '/w/a', agent: undefined })
  })
})

describe('useChildSessionReconciliation', () => {
  beforeEach(() => {
    mocks.getSession.mockReset()
    useSessionStatus.setState({
      statuses: new Map(),
      statusCache: new Map(),
      statusRevisions: new Map(),
      knownSessions: new Set(),
      outcomes: new Map(),
      revision: 0,
    })
  })

  const idleSession = (): SessionInfo => ({
    ...sessionInfo('child-1', '/repo'),
    time: { created: 1000, updated: 2000, idle: 2000 },
  })

  it('applies one guarded snapshot for multiple observers sharing one fetch', async () => {
    let resolveSession: ((value: SessionInfo) => void) | undefined
    mocks.getSession.mockImplementation(
      () => new Promise<SessionInfo>((resolve) => { resolveSession = resolve }),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    const first = renderHook(() => useChildSessionReconciliation('child-1'), { wrapper })
    const second = renderHook(() => useChildSessionReconciliation('child-1'), { wrapper })

    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveSession?.(idleSession())
    })

    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' })
    expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)

    first.unmount()
    second.unmount()
  })

  it('releases the snapshot when unmounted while the request is pending', async () => {
    let resolveSession: ((value: SessionInfo) => void) | undefined
    mocks.getSession.mockImplementation(
      () => new Promise<SessionInfo>((resolve) => { resolveSession = resolve }),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    const { unmount } = renderHook(() => useChildSessionReconciliation('child-1'), { wrapper })

    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(1))

    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'busy' })
    })
    expect(useSessionStatus.getState().statusRevisions.size).toBeGreaterThan(0)

    unmount()

    await act(async () => {
      resolveSession?.(idleSession())
    })

    await waitFor(() => expect(useSessionStatus.getState().statusRevisions.size).toBe(0))
  })

  it('clears a stale child outcome when the fresh snapshot is busy', async () => {
    mocks.getSession.mockResolvedValue(sessionInfo('child-1', '/repo'))
    useSessionStatus.getState().setStatus('child-1', { type: 'busy' })
    useSessionStatus.getState().setOutcome('child-1', 'failed')

    const queryClient = createQueryClient()
    renderHook(() => useChildSessionReconciliation('child-1'), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().statuses.get('child-1')).toEqual({ type: 'busy' })
    })
    expect(useSessionStatus.getState().outcomes.get('child-1')).toBeUndefined()
  })

  it('does not reconcile a child whose lifecycle is already terminal', async () => {
    useSessionStatus.getState().setStatus('child-1', { type: 'idle' })

    const queryClient = createQueryClient()
    renderHook(() => useChildSessionReconciliation('child-1'), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(queryClient.getQueryState(['opencode', 'session-reconcile', 'child-1'])?.fetchStatus).not.toBe('fetching')
  })
})
