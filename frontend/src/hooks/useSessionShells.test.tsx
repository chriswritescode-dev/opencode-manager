import { act, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { useKillShell, useShell } from './useSessionShells'
import { applyShellExit, clearShellExitRecord, recordShellExit, type ShellRecord } from '@/lib/backgroundWork'
import { renderHookWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const SHELLS_KEY = ['opencode', 'shells', '/repo']

const shell = (id: string, sessionID = 'session-1'): ShellRecord => ({
  id,
  status: 'running',
  command: `npm run ${id}`,
  cwd: '/repo',
  shell: 'zsh',
  file: `/tmp/${id}.log`,
  metadata: { sessionID },
  time: { started: 1 },
})

interface ShellServer {
  routes: FetchRoute[]
  setShells: (shells: ShellRecord[]) => void
}

function shellServer(initial: ShellRecord[] = []): ShellServer {
  let current = initial
  return {
    setShells: (shells) => {
      current = shells
    },
    routes: [
      {
        method: 'GET',
        path: '/api/opencode/api/shell',
        respond: () => ({ json: { data: current } }),
      },
      {
        method: 'DELETE',
        path: '/api/opencode/api/shell/:id',
        respond: () => ({ status: 204 }),
      },
    ],
  }
}

function cachedShells(queryClient: QueryClient): ShellRecord[] {
  return queryClient.getQueryData<ShellRecord[]>(SHELLS_KEY) ?? []
}

describe('useKillShell', () => {
  beforeEach(() => {
    clearShellExitRecord('/repo', 'dev')
    clearShellExitRecord('/repo', 'other')
  })

  it('marks a killed shell terminal without erasing it', async () => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(() => useKillShell('/repo'), {
      ...hookProviders,
      fetchRoutes: shellServer([]).routes,
    })
    queryClient.setQueryData<ShellRecord[]>(SHELLS_KEY, [shell('dev')])

    await act(async () => {
      await result.current.mutateAsync('dev')
    })

    const [updated] = cachedShells(queryClient)
    expect(updated?.status).toBe('killed')
    expect(updated?.time.completed).toBeDefined()
    expect(fetchFake.lastRequest('DELETE', '/api/opencode/api/shell/dev')?.method).toBe('DELETE')
  })

  it('records a killed shell so a later refetch keeps it killed', async () => {
    const server = shellServer([shell('dev')])
    const { result, queryClient } = renderHookWithProviders(
      () => ({ kill: useKillShell('/repo'), shell: useShell('dev', '/repo') }),
      { ...hookProviders, fetchRoutes: server.routes },
    )

    await act(async () => {
      await result.current.kill.mutateAsync('dev')
    })

    queryClient.setQueryData<ShellRecord[]>(SHELLS_KEY, [])
    server.setShells([shell('dev')])

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: SHELLS_KEY })
    })

    const [refetched] = cachedShells(queryClient)
    expect(refetched?.status).toBe('killed')
  })

  it('keeps a killed shell killed through a later exit event', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useKillShell('/repo'), {
      ...hookProviders,
      fetchRoutes: shellServer([shell('dev')]).routes,
    })
    queryClient.setQueryData<ShellRecord[]>(SHELLS_KEY, [shell('dev')])

    await act(async () => {
      await result.current.mutateAsync('dev')
    })

    await act(async () => {
      recordShellExit('/repo', { id: 'dev', status: 'exited', exit: 0 })
      queryClient.setQueryData<ShellRecord[]>(SHELLS_KEY, (current) =>
        current ? applyShellExit(current, { id: 'dev', status: 'exited', exit: 0 }) : current,
      )
    })

    const [after] = cachedShells(queryClient)
    expect(after?.status).toBe('killed')
  })
})

describe('useShell', () => {
  beforeEach(() => {
    clearShellExitRecord('/repo', 'dev')
    clearShellExitRecord('/repo', 'other')
  })

  it('returns only the matching shell record once the list loads', async () => {
    const server = shellServer([shell('dev'), shell('other')])
    const { result } = renderHookWithProviders(() => useShell('dev', '/repo'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    await waitFor(() => expect(result.current.shell?.id).toBe('dev'))
    expect(result.current.listLoaded).toBe(true)
  })

  it('does not re-render when an unrelated shell record changes', async () => {
    const dev = shell('dev')
    const other = shell('other')
    const server = shellServer([dev, other])
    let renderCount = 0

    const { result, queryClient } = renderHookWithProviders(
      () => {
        renderCount += 1
        return useShell('dev', '/repo')
      },
      { ...hookProviders, fetchRoutes: server.routes },
    )

    await waitFor(() => expect(result.current.shell).toEqual(dev))
    const rendersAfterLoad = renderCount

    await act(async () => {
      queryClient.setQueryData(SHELLS_KEY, [dev, { ...other, command: 'changed' }])
    })

    expect(renderCount).toBe(rendersAfterLoad)
  })
})
