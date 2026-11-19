import { act, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionPermissionModeState } from '@opencode-manager/shared/schemas'
import { useSessionPermissionMode, useSetSessionPermissionMode } from './useSessionPermissionMode'
import { renderHookWithProviders } from '@/test/render'

const remoteState: SessionPermissionModeState = {
  sessionId: 'ses_1',
  rootSessionId: 'ses_1',
  mode: 'auto',
  lockedReason: null,
}

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
  serverId: 'srv_remote',
} as const

describe('useSessionPermissionMode', () => {
  it('reads the mode for the current server', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useSessionPermissionMode('ses_1'),
      {
        ...hookProviders,
        fetchRoutes: [
          {
            method: 'GET',
            path: '/api/session-permission-modes/ses_1',
            respond: () => ({ json: remoteState }),
          },
        ],
      },
    )

    await waitFor(() => expect(result.current.data).toEqual(remoteState))

    expect(fetchFake.lastRequest('GET', '/api/session-permission-modes/ses_1')?.searchParams.get('serverId')).toBe('srv_remote')
  })

  it('writes the mode through the current server and updates the cached state', async () => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(
      () => useSetSessionPermissionMode('ses_1'),
      {
        ...hookProviders,
        fetchRoutes: [
          {
            method: 'PUT',
            path: '/api/session-permission-modes/ses_1',
            respond: () => ({ json: remoteState }),
          },
        ],
      },
    )

    await act(async () => {
      await result.current.mutateAsync({ directory: '/repo', mode: 'auto' })
    })

    expect(fetchFake.lastRequest('PUT', '/api/session-permission-modes/ses_1')?.body).toMatchObject({
      directory: '/repo',
      mode: 'auto',
      serverId: 'srv_remote',
    })
    expect(queryClient.getQueryData(['session-permission-mode', 'ses_1', 'srv_remote'])).toEqual(remoteState)
  })
})
