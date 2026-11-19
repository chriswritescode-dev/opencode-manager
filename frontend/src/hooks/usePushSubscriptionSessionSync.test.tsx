import { act, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSession } from '@/lib/auth-client'
import { usePushSubscriptionSessionSync } from './usePushSubscriptionSessionSync'
import { renderHookWithProviders } from '@/test/render'
import { installNotification, installServiceWorkerWithoutPushSubscription, installServiceWorkerPushSubscription } from '@/test/browserFakes'
import { makeAuthSession } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const pushSubscription = {
  endpoint: 'https://push.example.com/subscription',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
}

function sessionBody(sessionId: string | null) {
  if (sessionId === null) return null
  return makeAuthSession({
    session: {
      id: sessionId,
      userId: 'test-user',
      token: 'test-token',
      expiresAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  })
}

function useSessionSyncHarness() {
  usePushSubscriptionSessionSync()
  return useSession().refetch
}

const subscribeRoute: FetchRoute = {
  method: 'POST',
  path: '/api/notifications/subscribe',
  respond: (request) => ({
    json: {
      subscription: {
        id: 1,
        userId: 'test-user',
        endpoint: request.body?.endpoint,
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
        deviceName: null,
        createdAt: 1,
        lastUsedAt: null,
      },
    },
  }),
}

function renderSessionSync(initialSessionId: string | null) {
  let currentSessionId = initialSessionId
  const rendered = renderHookWithProviders(() => useSessionSyncHarness(), {
    ...hookProviders,
    fetchRoutes: [
      {
        method: 'GET',
        path: '/api/auth/get-session',
        respond: () => ({ json: sessionBody(currentSessionId) }),
      },
      subscribeRoute,
    ],
  })
  return {
    ...rendered,
    signInAs: (sessionId: string | null) => {
      currentSessionId = sessionId
    },
    refreshSession: async () => {
      await act(async () => {
        await rendered.result.current()
      })
    },
  }
}

describe('usePushSubscriptionSessionSync', () => {
  it('does not send before a session is signed in', async () => {
    installNotification('granted')
    installServiceWorkerPushSubscription()
    const { fetchFake, refreshSession } = renderSessionSync(null)

    await refreshSession()

    await waitFor(() => expect(fetchFake.findRequests('GET', '/api/auth/get-session').length).toBeGreaterThan(0))
    expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(0)
  })

  it('re-sends the registered subscription once a session is signed in', async () => {
    installNotification('granted')
    installServiceWorkerPushSubscription()
    const { fetchFake, refreshSession } = renderSessionSync('ses_first')
    const baseline = fetchFake.findRequests('POST', '/api/notifications/subscribe').length

    await refreshSession()

    await waitFor(() =>
      expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(baseline + 1),
    )
    expect(fetchFake.lastRequest('POST', '/api/notifications/subscribe')?.body).toEqual(pushSubscription)
  })

  it('re-sends the registered subscription again after the session changes', async () => {
    installNotification('granted')
    installServiceWorkerPushSubscription()
    const { fetchFake, refreshSession, signInAs, rerender } = renderSessionSync('ses_first')

    await refreshSession()
    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/notifications/subscribe').length).toBeGreaterThan(0))
    const baseline = fetchFake.findRequests('POST', '/api/notifications/subscribe').length

    signInAs('ses_second')
    rerender()
    await refreshSession()

    await waitFor(() =>
      expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(baseline + 1),
    )
  })

  it('sends the subscription only once for the same session', async () => {
    installNotification('granted')
    installServiceWorkerPushSubscription()
    const { fetchFake, refreshSession, rerender } = renderSessionSync('ses_first')

    await refreshSession()
    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/notifications/subscribe').length).toBeGreaterThan(0))
    const baseline = fetchFake.findRequests('POST', '/api/notifications/subscribe').length

    rerender()
    await refreshSession()

    expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(baseline)
  })

  it('does not send while notification permission is not granted', async () => {
    installNotification('default')
    installServiceWorkerPushSubscription()
    const { fetchFake, refreshSession } = renderSessionSync('ses_first')

    await refreshSession()

    await waitFor(() => expect(fetchFake.findRequests('GET', '/api/auth/get-session').length).toBeGreaterThan(0))
    expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(0)
  })

  it('does not send when the browser has no push subscription', async () => {
    installNotification('granted')
    installServiceWorkerWithoutPushSubscription()
    const { fetchFake, refreshSession } = renderSessionSync('ses_first')

    await refreshSession()

    await waitFor(() => expect(fetchFake.findRequests('GET', '/api/auth/get-session').length).toBeGreaterThan(0))
    expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(0)
  })
})
