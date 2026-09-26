import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLoadSkill } from '../useOpenCode'

import { showToast } from '../../lib/toast'

const mocks = vi.hoisted(() => ({
  activateSkill: vi.fn(),
}))

vi.mock('../../api/opencode', () => ({
  activateSkill: mocks.activateSkill,
}))

vi.mock('../../lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useLoadSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activates the skill for the session', async () => {
    mocks.activateSkill.mockResolvedValue(undefined)

    const { result } = renderHook(
      () => useLoadSkill('test-session-id'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mocks.activateSkill).toHaveBeenCalledTimes(1)
    expect(mocks.activateSkill).toHaveBeenCalledWith('test-session-id', 'my-skill')
  })

  it('throws error when sessionID is undefined', async () => {
    const { result } = renderHook(
      () => useLoadSkill(undefined),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toBe('No active session')
  })

  it('calls showToast.error when activating the skill fails', async () => {
    const testError = new Error('Command failed')
    mocks.activateSkill.mockRejectedValue(testError)

    const { result } = renderHook(
      () => useLoadSkill('test-session-id'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(showToast.error).toHaveBeenCalledTimes(1)
    expect(showToast.error).toHaveBeenCalledWith('Command failed')
  })

  it('calls showToast.error with default message for non-Error objects', async () => {
    mocks.activateSkill.mockRejectedValue('string error')

    const { result } = renderHook(
      () => useLoadSkill('test-session-id'),
      { wrapper: createWrapper() }
    )

    result.current.mutate({ skillName: 'my-skill' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(showToast.error).toHaveBeenCalledTimes(1)
    expect(showToast.error).toHaveBeenCalledWith('Failed to load skill')
  })
})
