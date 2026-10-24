import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePushSubscriptionSessionSync } from './usePushSubscriptionSessionSync'

const authState = vi.hoisted(() => ({ sessionId: null as string | null }))
const serviceWorker = vi.hoisted(() => ({ getServiceWorkerRegistration: vi.fn() }))
const notificationsApi = vi.hoisted(() => ({ subscribe: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: authState.sessionId ? { session: { id: authState.sessionId }, user: { id: 'user-1' } } : null,
  }),
}))

vi.mock('@/lib/serviceWorker', () => ({
  getServiceWorkerRegistration: serviceWorker.getServiceWorkerRegistration,
  urlBase64ToUint8Array: vi.fn(() => new Uint8Array([1, 2, 3])),
}))

vi.mock('@/api/notifications', () => ({ notificationsApi }))

const subscriptionJson = {
  endpoint: 'https://push.example.com/phone',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
}

function grantNotificationPermission(): void {
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'granted' },
  })
}

describe('usePushSubscriptionSessionSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.sessionId = 'ses_first'
    grantNotificationPermission()
    serviceWorker.getServiceWorkerRegistration.mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({ toJSON: () => subscriptionJson }),
      },
    })
    notificationsApi.subscribe.mockResolvedValue({ subscription: { id: 1 } })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'Notification')
  })

  it('re-sends the registered subscription once a session is signed in', async () => {
    renderHook(() => usePushSubscriptionSessionSync())

    await waitFor(() => {
      expect(notificationsApi.subscribe).toHaveBeenCalledTimes(1)
    })
    expect(notificationsApi.subscribe).toHaveBeenCalledWith(subscriptionJson, undefined)
  })

  it('re-sends the registered subscription again after the session changes', async () => {
    const { rerender } = renderHook(() => usePushSubscriptionSessionSync())

    await waitFor(() => {
      expect(notificationsApi.subscribe).toHaveBeenCalledTimes(1)
    })

    authState.sessionId = 'ses_second'
    rerender()

    await waitFor(() => {
      expect(notificationsApi.subscribe).toHaveBeenCalledTimes(2)
    })
    expect(notificationsApi.subscribe).toHaveBeenLastCalledWith(subscriptionJson, undefined)
  })

  it('sends the subscription only once for the same session', async () => {
    const { rerender } = renderHook(() => usePushSubscriptionSessionSync())

    await waitFor(() => {
      expect(notificationsApi.subscribe).toHaveBeenCalledTimes(1)
    })

    rerender()

    await waitFor(() => {
      expect(notificationsApi.subscribe).toHaveBeenCalledTimes(1)
    })
  })

  it('does not send while notification permission is not granted', async () => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default' },
    })

    renderHook(() => usePushSubscriptionSessionSync())

    await waitFor(() => {
      expect(serviceWorker.getServiceWorkerRegistration).not.toHaveBeenCalled()
    })
    expect(notificationsApi.subscribe).not.toHaveBeenCalled()
  })

  it('does not send when the browser has no push subscription', async () => {
    serviceWorker.getServiceWorkerRegistration.mockResolvedValue({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(null) },
    })

    renderHook(() => usePushSubscriptionSessionSync())

    await waitFor(() => {
      expect(serviceWorker.getServiceWorkerRegistration).toHaveBeenCalled()
    })
    expect(notificationsApi.subscribe).not.toHaveBeenCalled()
  })

  it('does not send before a session is signed in', async () => {
    authState.sessionId = null

    renderHook(() => usePushSubscriptionSessionSync())

    await waitFor(() => {
      expect(serviceWorker.getServiceWorkerRegistration).not.toHaveBeenCalled()
    })
    expect(notificationsApi.subscribe).not.toHaveBeenCalled()
  })
})
