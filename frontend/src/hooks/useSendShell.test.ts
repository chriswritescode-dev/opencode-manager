import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useSendShell } from './useOpenCode'
import { useSessionStatus } from '../stores/sessionStatusStore'

const mockSendShell = vi.fn()

vi.mock('../api/opencode', async () => {
  const actual = await vi.importActual('../api/opencode')
  return {
    ...actual,
    OpenCodeClient: vi.fn().mockImplementation(() => ({
      sendShell: mockSendShell,
    })),
  }
})

vi.mock('../lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

describe('useSendShell', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStatus.getState().replaceStatuses({})
    queryClient = createTestQueryClient()
  })

  const renderHookWithProviders = () =>
    renderHook(
      () => useSendShell('http://localhost:5551', '/test'),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      }
    )

  it('sets session status to busy on shell send', async () => {
    mockSendShell.mockReturnValue(new Promise(() => {}))

    const { result } = renderHookWithProviders()
    result.current.mutate({ sessionID: 'shell-session', command: 'ls', agent: 'general' })

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('shell-session').type).toBe('busy')
    })
  })

  it('rolls back to idle when shell send fails', async () => {
    mockSendShell.mockRejectedValue(new Error('boom'))

    const { result } = renderHookWithProviders()
    result.current.mutate({ sessionID: 'shell-session', command: 'ls', agent: 'general' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(useSessionStatus.getState().getStatus('shell-session').type).toBe('idle')
  })
})
