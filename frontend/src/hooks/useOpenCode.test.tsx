import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeleteSession } from './useOpenCode'

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
