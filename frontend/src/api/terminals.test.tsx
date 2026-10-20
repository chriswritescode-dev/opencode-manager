import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resizeTerminal, useCreateTerminal, useRemoveTerminal, useTerminals } from './terminals'

const fetchMock = vi.fn()

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function createWrapper(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function lastRequestUrl(): string {
  return String(fetchMock.mock.calls.at(-1)?.[0])
}

describe('terminal api targets', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists repo terminals through the repo route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ terminals: [] }))

    const { result } = renderHook(
      () => useTerminals({ kind: 'repo', repoId: 1 }, '/repo', { enabled: true }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = new URL(lastRequestUrl())
    expect(url.pathname).toBe('/api/repos/1/terminals')
    expect(url.searchParams.get('directory')).toBe('/repo')
  })

  it('lists linked server terminals through the server route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ terminals: [] }))

    const { result } = renderHook(
      () => useTerminals({ kind: 'server', serverId: 'srv_kitchen' }, '/home/me/app', { enabled: true }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = new URL(lastRequestUrl())
    expect(url.pathname).toBe('/api/opencode-servers/srv_kitchen/terminals')
    expect(url.searchParams.get('directory')).toBe('/home/me/app')
  })

  it('scopes the query key to the linked server', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ terminals: [] }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(
      () => useTerminals({ kind: 'server', serverId: 'srv_kitchen' }, '/home/me/app', { enabled: true }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      queryClient.getQueryCache().findAll({ queryKey: ['terminals', 'srv_kitchen'] }),
    ).toHaveLength(1)
  })

  it('creates a linked server terminal through the server route', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'pty-1', title: 'Terminal', kind: 'shell', cwd: '/home/me/app', status: 'running' }),
    )

    const { result } = renderHook(
      () => useCreateTerminal({ kind: 'server', serverId: 'srv_kitchen' }),
      { wrapper: createWrapper() },
    )

    await act(() => result.current.mutateAsync({ directory: '/home/me/app' }))

    const url = new URL(lastRequestUrl())
    expect(url.pathname).toBe('/api/opencode-servers/srv_kitchen/terminals')
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('POST')
  })

  it('removes a linked server terminal with the directory', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const { result } = renderHook(
      () => useRemoveTerminal({ kind: 'server', serverId: 'srv_kitchen' }),
      { wrapper: createWrapper() },
    )

    await act(() => result.current.mutateAsync({ ptyID: 'pty 1', directory: '/home/me/app' }))

    const url = new URL(lastRequestUrl())
    expect(url.pathname).toBe('/api/opencode-servers/srv_kitchen/terminals/pty%201')
    expect(url.searchParams.get('directory')).toBe('/home/me/app')
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })

  it('resizes a linked server terminal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }))

    await resizeTerminal({ kind: 'server', serverId: 'srv_kitchen' }, 'pty-1', {
      directory: '/home/me/app',
      cols: 80,
      rows: 24,
    })

    const url = new URL(lastRequestUrl())
    expect(url.pathname).toBe('/api/opencode-servers/srv_kitchen/terminals/pty-1')
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('PATCH')
  })
})
