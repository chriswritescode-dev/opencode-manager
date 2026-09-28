import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useKillShell, useShell } from './useSessionShells'
import { applyShellExit, clearShellExitRecord, recordShellExit, type ShellRecord } from '@/lib/backgroundWork'

const api = vi.hoisted(() => ({
  listShells: vi.fn(),
  removeShell: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/opencode')>()),
  ...api,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), loading: vi.fn() },
}))

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

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('useKillShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listShells.mockResolvedValue([])
    api.removeShell.mockResolvedValue(undefined)
  })

  it('marks a killed shell terminal without erasing it', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['opencode', 'shells', '/repo'], [shell('dev')])

    const { result } = renderHook(() => useKillShell('/repo'), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('dev')
    })

    const [updated] = queryClient.getQueryData<ShellRecord[]>(['opencode', 'shells', '/repo']) ?? []
    expect(updated?.status).toBe('killed')
    expect(updated?.time.completed).toBeDefined()
    clearShellExitRecord('/repo', 'dev')
  })

  it('records a killed shell so a later refetch keeps it killed', async () => {
    const queryClient = createQueryClient()
    const key = ['opencode', 'shells', '/repo']
    queryClient.setQueryData(key, [shell('dev')])

    const { result } = renderHook(
      () => ({ kill: useKillShell('/repo'), shell: useShell('dev', '/repo') }),
      { wrapper: createWrapper(queryClient) },
    )

    await act(async () => {
      await result.current.kill.mutateAsync('dev')
    })

    queryClient.setQueryData(key, [])
    api.listShells.mockResolvedValue([shell('dev')])

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: key })
    })

    const [refetched] = queryClient.getQueryData<ShellRecord[]>(key) ?? []
    expect(refetched?.status).toBe('killed')
    clearShellExitRecord('/repo', 'dev')
  })

  it('keeps a killed shell killed through a later exit event', async () => {
    const queryClient = createQueryClient()
    const key = ['opencode', 'shells', '/repo']
    queryClient.setQueryData(key, [shell('dev')])

    const { result } = renderHook(() => useKillShell('/repo'), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('dev')
    })

    await act(async () => {
      recordShellExit('/repo', { id: 'dev', status: 'exited', exit: 0 })
      queryClient.setQueryData<ShellRecord[]>(key, (current) =>
        current ? applyShellExit(current, { id: 'dev', status: 'exited', exit: 0 }) : current,
      )
    })

    const [after] = queryClient.getQueryData<ShellRecord[]>(key) ?? []
    expect(after?.status).toBe('killed')
    clearShellExitRecord('/repo', 'dev')
  })
})

describe('useShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listShells.mockResolvedValue([])
    api.removeShell.mockResolvedValue(undefined)
  })

  it('returns only the matching shell record once the list loads', async () => {
    const queryClient = createQueryClient()
    api.listShells.mockResolvedValue([shell('dev'), shell('other')])

    const { result } = renderHook(() => useShell('dev', '/repo'), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.shell?.id).toBe('dev'))
    expect(result.current.listLoaded).toBe(true)
  })

  it('does not re-render when an unrelated shell record changes', async () => {
    const queryClient = createQueryClient()
    const dev = shell('dev')
    const other = shell('other')
    api.listShells.mockResolvedValue([dev, other])

    let renderCount = 0
    const { result } = renderHook(
      () => {
        renderCount += 1
        return useShell('dev', '/repo')
      },
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.shell).toBe(dev))
    const rendersAfterLoad = renderCount

    await act(async () => {
      queryClient.setQueryData(['opencode', 'shells', '/repo'], [dev, { ...other, command: 'changed' }])
    })

    expect(renderCount).toBe(rendersAfterLoad)
  })
})
