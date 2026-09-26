import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOpenCodeServerActions } from './useOpenCodeServerActions'

const mocks = vi.hoisted(() => ({
  getActiveOpenCodeSessions: vi.fn(),
  restartOpenCodeServer: vi.fn(),
  upgradeOpenCode: vi.fn(),
  refreshOpenCodeServerCaches: vi.fn(),
  showToast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getActiveOpenCodeSessions: mocks.getActiveOpenCodeSessions,
    restartOpenCodeServer: mocks.restartOpenCodeServer,
    upgradeOpenCode: mocks.upgradeOpenCode,
  },
}))

vi.mock('@/lib/queryInvalidation', () => ({
  refreshOpenCodeServerCaches: mocks.refreshOpenCodeServerCaches,
}))

vi.mock('@/lib/toast', () => ({
  showToast: mocks.showToast,
}))

vi.mock('@/lib/opencode-errors', () => ({
  getOpenCodeApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('useOpenCodeServerActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.restartOpenCodeServer.mockResolvedValue({ success: true, message: 'OpenCode server restarted successfully' })
  })

  it('restarts immediately when no session is active', async () => {
    mocks.getActiveOpenCodeSessions.mockResolvedValue({ count: 0, sessions: [] })

    const { result } = renderHook(() => useOpenCodeServerActions(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await act(async () => {
      await result.current.requestRestart()
    })

    expect(mocks.restartOpenCodeServer).toHaveBeenCalledTimes(1)
    expect(result.current.confirmOpen).toBe(false)
  })

  it('opens the confirmation dialog instead of restarting when sessions are active', async () => {
    mocks.getActiveOpenCodeSessions.mockResolvedValue({ count: 2, sessions: [] })

    const { result } = renderHook(() => useOpenCodeServerActions(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await act(async () => {
      await result.current.requestRestart()
    })

    expect(mocks.restartOpenCodeServer).not.toHaveBeenCalled()
    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.activeSessionCount).toBe(2)
  })

  it('restarts and closes the dialog when the restart is confirmed', async () => {
    mocks.getActiveOpenCodeSessions.mockResolvedValue({ count: 1, sessions: [] })

    const { result } = renderHook(() => useOpenCodeServerActions(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await act(async () => {
      await result.current.requestRestart()
    })
    await act(async () => {
      await result.current.confirmRestart()
    })

    expect(mocks.restartOpenCodeServer).toHaveBeenCalledTimes(1)
    expect(result.current.confirmOpen).toBe(false)
  })
})
