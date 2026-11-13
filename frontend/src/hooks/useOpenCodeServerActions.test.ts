import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOpenCodeServerActions } from './useOpenCodeServerActions'
import { renderHookWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

const restartResponse = { success: true, message: 'OpenCode server restarted successfully' }
const healthQueryKey = ['health'] as const

function activeSessionsRoute(count: number): FetchRoute {
  return {
    method: 'GET',
    path: '/api/settings/opencode-active-sessions',
    respond: () => ({
      json: {
        count,
        sessions: Array.from({ length: count }, (_, index) => ({
          sessionID: `ses_${index}`,
          directory: '/repo',
        })),
      },
    }),
  }
}

const restartRoute: FetchRoute = {
  method: 'POST',
  path: '/api/settings/opencode-restart',
  respond: () => ({ json: restartResponse }),
}

describe('useOpenCodeServerActions', () => {
  it('restarts immediately when no session is active', async () => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(() => useOpenCodeServerActions(), {
      ...hookProviders,
      fetchRoutes: [activeSessionsRoute(0), restartRoute],
    })
    queryClient.setQueryData(healthQueryKey, {})

    await act(async () => {
      await result.current.requestRestart()
    })

    expect(fetchFake.findRequests('POST', '/api/settings/opencode-restart')).toHaveLength(1)
    expect(result.current.confirmOpen).toBe(false)
    expect(await screen.findByText('Server restarted successfully')).toBeInTheDocument()
    expect(queryClient.getQueryState(healthQueryKey)?.isInvalidated).toBe(true)
  })

  it('opens the confirmation dialog instead of restarting when sessions are active', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useOpenCodeServerActions(), {
      ...hookProviders,
      fetchRoutes: [activeSessionsRoute(2), restartRoute],
    })

    await act(async () => {
      await result.current.requestRestart()
    })

    expect(fetchFake.findRequests('POST', '/api/settings/opencode-restart')).toHaveLength(0)
    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.activeSessionCount).toBe(2)
  })

  it('restarts and closes the dialog when the restart is confirmed', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useOpenCodeServerActions(), {
      ...hookProviders,
      fetchRoutes: [activeSessionsRoute(1), restartRoute],
    })

    await act(async () => {
      await result.current.requestRestart()
    })
    expect(result.current.confirmOpen).toBe(true)

    await act(async () => {
      await result.current.confirmRestart()
    })

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/settings/opencode-restart')).toHaveLength(1))
    expect(result.current.confirmOpen).toBe(false)
    expect(await screen.findByText('Server restarted successfully')).toBeInTheDocument()
  })
})
