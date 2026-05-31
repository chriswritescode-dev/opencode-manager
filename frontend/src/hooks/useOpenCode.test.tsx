import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeleteSession, useSessionsAcrossDirectories } from './useOpenCode'

vi.mock('../lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useDeleteSession', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to workspace delete for stale workspace session deletes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Workspace not found: wrk_stale', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useDeleteSession('/api/opencode', ['/w/stale']), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { id: 'ses_1', directory: '/w/stale', workspaceID: 'wrk_stale' },
        { id: 'ses_2', directory: '/w/stale', workspaceID: 'wrk_stale' },
      ])
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost/api/opencode/session/ses_1?directory=%2Fw%2Fstale',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost/api/opencode/experimental/workspace/wrk_stale?directory=%2Fw%2Fstale',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('falls back to workspace delete for OpenCode unknown session delete failures', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: 'UnknownError',
        data: { message: 'Unexpected server error. Check server logs for details.' },
      }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useDeleteSession('/api/opencode', ['/w/existing']), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ id: 'ses_1', directory: '/w/existing', workspaceID: 'wrk_existing' }])
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost/api/opencode/experimental/workspace/wrk_existing?directory=%2Fw%2Fexisting',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('useSessionsAcrossDirectories', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches first page of sessions with v2 pagination and adapted items', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        items: [
          { id: 'session-1', projectID: 'proj-1', title: 'Test Session', time: { created: 1000, updated: 1000 } },
        ],
        cursor: { next: 'cursor_abc' },
      }), { headers: { 'Content-Type': 'application/json' } }),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSessionsAcrossDirectories('/api/opencode', ['/repo']), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].id).toBe('session-1')
    expect(result.current.data[0].title).toBe('Test Session')
    expect(result.current.hasNextPage).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/opencode/api/session?limit=25&order=desc&directory=%2Frepo',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('fetches next page via cursor when fetchNextPage is called and flattens items', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            { id: 'session-1', projectID: 'proj-1', title: 'Page 1', time: { created: 1000, updated: 1000 } },
          ],
          cursor: { next: 'cursor_next' },
        }), { headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            { id: 'session-2', projectID: 'proj-1', title: 'Page 2', time: { created: 2000, updated: 2000 } },
          ],
        }), { headers: { 'Content-Type': 'application/json' } }),
      )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSessionsAcrossDirectories('/api/opencode', ['/repo']), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].id).toBe('session-1')

    await act(async () => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })

    expect(result.current.data[0].id).toBe('session-1')
    expect(result.current.data[1].id).toBe('session-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost/api/opencode/api/session?cursor=cursor_next',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('handles multi-directory cursors and only fetches directories with nextCursor', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            { id: 'session-a1', projectID: 'proj-1', title: 'Session A1', time: { created: 1000, updated: 1000 } },
          ],
          cursor: { next: 'cursor_a' },
        }), { headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            { id: 'session-b1', projectID: 'proj-1', title: 'Session B1', time: { created: 1000, updated: 1000 } },
          ],
        }), { headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            { id: 'session-a2', projectID: 'proj-1', title: 'Session A2', time: { created: 2000, updated: 2000 } },
          ],
        }), { headers: { 'Content-Type': 'application/json' } }),
      )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useSessionsAcrossDirectories('/api/opencode', ['/w/a', '/w/b']),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toHaveLength(2)
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      result.current.fetchNextPage()
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost/api/opencode/api/session?cursor=cursor_a',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('sends search parameter when search option is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        items: [
          { id: 'session-1', projectID: 'proj-1', title: 'Deploy Session', time: { created: 1000, updated: 1000 } },
        ],
      }), { headers: { 'Content-Type': 'application/json' } }),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useSessionsAcrossDirectories('/api/opencode', ['/repo'], { search: 'deploy' }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/opencode/api/session?limit=25&order=desc&search=deploy&directory=%2Frepo',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
