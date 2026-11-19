import { act, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TerminalInfo } from '@opencode-manager/shared/types'
import { createFetchFake, type FetchRoute } from '@/test/fetchFake'
import { renderHookWithProviders } from '@/test/render'
import { resizeTerminal, useCreateTerminal, useRemoveTerminal, useTerminals } from './terminals'

const hookProviders = { auth: false, theme: false, toaster: false } as const

const terminal: TerminalInfo = {
  id: 'pty-1',
  title: 'Terminal',
  kind: 'shell',
  cwd: '/home/me/app',
  status: 'running',
}

const listCases = [
  {
    title: 'lists repo terminals through the repo route',
    target: { kind: 'repo', repoId: 1 },
    collectionPath: '/api/repos/1/terminals',
  },
  {
    title: 'lists linked server terminals through the server route',
    target: { kind: 'server', serverId: 'srv_kitchen' },
    collectionPath: '/api/opencode-servers/srv_kitchen/terminals',
  },
] as const

describe('terminal api targets', () => {
  it.each(listCases)('$title', async ({ target, collectionPath }) => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useTerminals(target, '/home/me/app', { enabled: true }),
      {
        ...hookProviders,
        fetchRoutes: [
          { method: 'GET', path: collectionPath, respond: () => ({ json: { terminals: [terminal] } }) },
        ],
      },
    )

    await waitFor(() => expect(result.current.data).toEqual([terminal]))
    expect(fetchFake.lastRequest('GET', collectionPath)?.searchParams.get('directory')).toBe('/home/me/app')
  })

  it('scopes the query key to the linked server', async () => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(
      () => useTerminals({ kind: 'server', serverId: 'srv_kitchen' }, '/home/me/app', { enabled: true }),
      {
        ...hookProviders,
        fetchRoutes: [
          {
            method: 'GET',
            path: '/api/opencode-servers/srv_kitchen/terminals',
            respond: () => ({ json: { terminals: [] } }),
          },
        ],
      },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryCache().findAll({ queryKey: ['terminals', 'srv_kitchen'] })).toHaveLength(1)
    expect(fetchFake.findRequests('GET', '/api/opencode-servers/srv_kitchen/terminals')).toHaveLength(1)
  })

  it('creates a linked server terminal through the server route', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useCreateTerminal({ kind: 'server', serverId: 'srv_kitchen' }),
      {
        ...hookProviders,
        fetchRoutes: [
          {
            method: 'POST',
            path: '/api/opencode-servers/srv_kitchen/terminals',
            respond: () => ({ json: terminal }),
          },
        ],
      },
    )

    await act(async () => {
      await result.current.mutateAsync({ directory: '/home/me/app' })
    })

    expect(fetchFake.lastRequest('POST', '/api/opencode-servers/srv_kitchen/terminals')?.body).toEqual({
      directory: '/home/me/app',
    })
  })

  it('removes a linked server terminal with the directory', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useRemoveTerminal({ kind: 'server', serverId: 'srv_kitchen' }),
      {
        ...hookProviders,
        fetchRoutes: [
          {
            method: 'DELETE',
            path: '/api/opencode-servers/srv_kitchen/terminals/pty%201',
            respond: () => ({ status: 204 }),
          },
        ],
      },
    )

    await act(async () => {
      await result.current.mutateAsync({ ptyID: 'pty 1', directory: '/home/me/app' })
    })

    const removeRequest = fetchFake.lastRequest('DELETE', '/api/opencode-servers/srv_kitchen/terminals/pty%201')
    expect(removeRequest?.searchParams.get('directory')).toBe('/home/me/app')
  })

  it('resizes a linked server terminal', async () => {
    const routes: FetchRoute[] = [
      {
        method: 'PATCH',
        path: '/api/opencode-servers/srv_kitchen/terminals/pty-1',
        respond: () => ({ json: { success: true } }),
      },
    ]
    const fetchFake = createFetchFake(routes)
    fetchFake.install()

    await resizeTerminal({ kind: 'server', serverId: 'srv_kitchen' }, 'pty-1', {
      directory: '/home/me/app',
      cols: 80,
      rows: 24,
    })

    expect(fetchFake.lastRequest('PATCH', '/api/opencode-servers/srv_kitchen/terminals/pty-1')?.body).toEqual({
      directory: '/home/me/app',
      cols: 80,
      rows: 24,
    })
  })
})
