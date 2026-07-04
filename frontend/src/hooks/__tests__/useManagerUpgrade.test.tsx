import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useManagerUpgrade } from '../useManagerUpgrade'
import type { ManagerUpgradeStatusResponse } from '@/api/settings'

const mocks = vi.hoisted(() => ({
  getManagerUpgradeStatus: vi.fn(),
  startManagerUpgrade: vi.fn(),
  getActiveOpenCodeSessions: vi.fn(),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getManagerUpgradeStatus: mocks.getManagerUpgradeStatus,
    startManagerUpgrade: mocks.startManagerUpgrade,
    getActiveOpenCodeSessions: mocks.getActiveOpenCodeSessions,
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function makeStatus(overrides: Partial<ManagerUpgradeStatusResponse> = {}): ManagerUpgradeStatusResponse {
  return {
    supported: true,
    inDocker: true,
    socketAvailable: true,
    enabled: true,
    currentVersion: '1.0.0',
    job: null,
    ...overrides,
  }
}

describe('useManagerUpgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActiveOpenCodeSessions.mockResolvedValue({ count: 0, sessions: [] })
  })

  it('isSupported should be false when getManagerUpgradeStatus returns supported: false', async () => {
    const status = makeStatus({ supported: false, enabled: false, currentVersion: null })
    mocks.getManagerUpgradeStatus.mockResolvedValue(status)

    const { result } = renderHook(() => useManagerUpgrade(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(status)
    })

    expect(result.current.isSupported).toBe(false)
  })

  it('isSupported should be true when getManagerUpgradeStatus returns supported: true', async () => {
    mocks.getManagerUpgradeStatus.mockResolvedValue(makeStatus())

    const { result } = renderHook(() => useManagerUpgrade(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true)
    })
  })

  it('requestUpgrade starts the upgrade immediately when no sessions are active', async () => {
    mocks.getManagerUpgradeStatus.mockResolvedValue(makeStatus())
    mocks.startManagerUpgrade.mockResolvedValue({ job: { id: 1, status: 'pulling', fromVersion: '1.0.0', toVersion: 'latest', targetImage: null, error: null, startedAt: Date.now(), finishedAt: null } })

    const { result } = renderHook(() => useManagerUpgrade(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true)
    })

    await result.current.requestUpgrade()

    expect(mocks.startManagerUpgrade).toHaveBeenCalledTimes(1)
    expect(result.current.confirmOpen).toBe(false)
  })

  it('requestUpgrade opens the confirmation dialog instead of upgrading when sessions are active', async () => {
    mocks.getManagerUpgradeStatus.mockResolvedValue(makeStatus())
    mocks.getActiveOpenCodeSessions.mockResolvedValue({ count: 2, sessions: [] })

    const { result } = renderHook(() => useManagerUpgrade(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true)
    })

    await result.current.requestUpgrade()

    expect(mocks.startManagerUpgrade).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(result.current.confirmOpen).toBe(true)
    })
    expect(result.current.activeSessionCount).toBe(2)
  })

  it('confirmUpgrade closes the dialog and starts the upgrade', async () => {
    mocks.getManagerUpgradeStatus.mockResolvedValue(makeStatus())
    mocks.startManagerUpgrade.mockResolvedValue({ job: { id: 1, status: 'pulling', fromVersion: '1.0.0', toVersion: 'latest', targetImage: null, error: null, startedAt: Date.now(), finishedAt: null } })

    const { result } = renderHook(() => useManagerUpgrade(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true)
    })

    await result.current.confirmUpgrade()

    expect(mocks.startManagerUpgrade).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(result.current.confirmOpen).toBe(false)
    })
  })
})
