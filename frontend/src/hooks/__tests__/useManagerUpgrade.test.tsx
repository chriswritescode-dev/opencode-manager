import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useManagerUpgrade } from '../useManagerUpgrade'
import type { ManagerUpgradeStatus } from '@/api/settings'

const mocks = vi.hoisted(() => ({
  getManagerUpgradeStatus: vi.fn(),
  startManagerUpgrade: vi.fn(),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getManagerUpgradeStatus: mocks.getManagerUpgradeStatus,
    startManagerUpgrade: mocks.startManagerUpgrade,
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

describe('useManagerUpgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isSupported should be false when getManagerUpgradeStatus returns supported: false', async () => {
    const status: ManagerUpgradeStatus = {
      supported: false,
      inDocker: true,
      socketAvailable: true,
      enabled: false,
      currentVersion: null,
      job: null,
    }
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
    const status: ManagerUpgradeStatus = {
      supported: true,
      inDocker: true,
      socketAvailable: true,
      enabled: true,
      currentVersion: '1.0.0',
      job: null,
    }
    mocks.getManagerUpgradeStatus.mockResolvedValue(status)

    const { result } = renderHook(() => useManagerUpgrade(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true)
    })
  })

  it('startUpgrade should call settingsApi.startManagerUpgrade', async () => {
    const status: ManagerUpgradeStatus = {
      supported: true,
      inDocker: true,
      socketAvailable: true,
      enabled: true,
      currentVersion: '1.0.0',
      job: null,
    }
    mocks.getManagerUpgradeStatus.mockResolvedValue(status)
    mocks.startManagerUpgrade.mockResolvedValue({ job: { id: 1, status: 'pending', fromVersion: '1.0.0', toVersion: 'latest', targetImage: null, error: null, startedAt: Date.now(), finishedAt: null } })

    const { result } = renderHook(() => useManagerUpgrade(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true)
    })

    await result.current.startUpgrade()

    expect(mocks.startManagerUpgrade).toHaveBeenCalledTimes(1)
  })
})
