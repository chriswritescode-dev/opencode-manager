import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { useResolveConflictsWithAgent } from './useResolveConflictsWithAgent'

const mocks = vi.hoisted(() => ({
  createSessionWithPrompt: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  createSessionWithPrompt: mocks.createSessionWithPrompt,
}))

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('@/lib/toast', () => ({
  showToast: { error: toastMocks.error },
}))

const locationRef: { current: string } = { current: '' }

function LocationProbe() {
  const location = useLocation()
  useEffect(() => {
    locationRef.current = location.pathname
  })
  return null
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/1']}>
          <LocationProbe />
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('useResolveConflictsWithAgent', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    locationRef.current = '/repos/1'
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    mocks.createSessionWithPrompt.mockResolvedValue({ id: 'ses_new' })
  })

  const renderResolve = () =>
    renderHook(() => useResolveConflictsWithAgent({ id: 1, fullPath: '/abs/repos/my-repo' }), {
      wrapper: createWrapper(queryClient),
    })

  it('creates one session in the repo directory, sends one prompt, and navigates to it', async () => {
    const { result } = renderResolve()

    await act(async () => {
      await result.current.mutateAsync({
        operation: { kind: 'rebase', conflictedFiles: ['src/a.ts'] },
        branch: 'main',
      })
    })

    expect(mocks.createSessionWithPrompt).toHaveBeenCalledTimes(1)
    expect(mocks.createSessionWithPrompt).toHaveBeenCalledWith(
      {
        directory: '/abs/repos/my-repo',
        title: 'Resolve rebase conflicts',
      },
      expect.stringContaining('GIT_EDITOR=true git rebase --continue'),
    )
    await waitFor(() => expect(locationRef.current).toBe('/repos/1/sessions/ses_new'))
  })

  it('shows an error without navigating when creating the session fails', async () => {
    mocks.createSessionWithPrompt.mockRejectedValue(new Error('gateway timeout'))
    const { result } = renderResolve()

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          operation: { kind: 'merge', conflictedFiles: ['file.txt'] },
          branch: 'main',
        }),
      ).rejects.toThrow('gateway timeout')
    })

    expect(mocks.createSessionWithPrompt).toHaveBeenCalledTimes(1)
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(locationRef.current).toBe('/repos/1')
  })
})
