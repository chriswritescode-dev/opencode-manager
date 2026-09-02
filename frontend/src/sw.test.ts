import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown) => void

const listeners: Record<string, Listener[]> = {}

function makeWorkerGlobalScope() {
  const scope = {
    addEventListener(type: string, listener: Listener) {
      listeners[type] = listeners[type] ?? []
      listeners[type].push(listener)
    },
    skipWaiting: vi.fn(async () => {}),
    location: { origin: 'http://localhost' },
    registration: {
      showNotification: vi.fn(async () => {}),
    },
    clients: {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => ({})),
      claim: vi.fn(async () => {}),
    },
  }
  ;(globalThis as Record<string, unknown>).self = scope
  ;(globalThis as Record<string, unknown>).caches = {
    open: vi.fn(async () => ({ addAll: vi.fn(async () => {}), put: vi.fn(async () => {}) })),
    keys: vi.fn(async () => []),
    match: vi.fn(async () => undefined),
    delete: vi.fn(async () => true),
  }
  return scope
}

function dispatch(type: string, event: unknown) {
  const typeListeners = listeners[type] ?? []
  expect(typeListeners.length).toBeGreaterThan(0)
  for (const listener of typeListeners) listener(event)
}

async function dispatchAndWait(type: string, event: unknown) {
  const promises: Promise<void>[] = []
  const enriched = {
    ...event,
    waitUntil: (promise: Promise<void>) => {
      promises.push(promise)
    },
  }
  dispatch(type, enriched)
  await Promise.all(promises)
}

function makeClient(overrides: Partial<WindowClient> & { url: string }) {
  return {
    focused: false,
    visibilityState: 'visible',
    postMessage: vi.fn(),
    focus: vi.fn(async () => overrides),
    ...overrides,
  }
}

describe('service worker notifications', () => {
  let scope: ReturnType<typeof makeWorkerGlobalScope>

  beforeEach(async () => {
    vi.resetModules()
    for (const key of Object.keys(listeners)) delete listeners[key]
    scope = makeWorkerGlobalScope()
    await import('./sw')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('push', () => {
    it('shows high-priority notification with defaults from payload', async () => {
      const payload = {
        title: 'Permission requested',
        body: 'A session needs approval',
        tag: 'repo-1-session-1',
        renotify: true,
        timestamp: 123,
        data: {
          eventType: 'permission.asked',
          url: '/repos/1/sessions/s',
        },
      }

      await dispatchAndWait('push', {
        data: { json: () => payload, text: () => '' },
      })

      expect(scope.registration.showNotification).toHaveBeenCalledWith(
        'Permission requested',
        expect.objectContaining({
          badge: '/icons/badge-96x96.png',
          icon: '/icons/icon-512x512.png',
          renotify: true,
          timestamp: 123,
          requireInteraction: true,
          tag: 'repo-1-session-1',
        })
      )
    })

    it('does not require interaction for low-priority events', async () => {
      const payload = {
        title: 'Session idle',
        body: 'Done',
        tag: 'repo-1-session-1',
        data: { eventType: 'session.idle' },
      }

      await dispatchAndWait('push', {
        data: { json: () => payload, text: () => '' },
      })

      expect(scope.registration.showNotification).toHaveBeenCalledWith(
        'Session idle',
        expect.objectContaining({ requireInteraction: false, renotify: false })
      )
    })
  })

  describe('notificationclick', () => {
    it('posts message to the client already on the target pathname and focuses it', async () => {
      const matchClient = makeClient({ url: 'http://localhost/repos/1/sessions/s' })
      const focusedClient = makeClient({ url: 'http://localhost/repos/1', focused: true })
      scope.clients.matchAll.mockResolvedValue([focusedClient, matchClient])

      await dispatchAndWait('notificationclick', {
        notification: {
          close: vi.fn(),
          data: { url: '/repos/1/sessions/s' },
        },
      })

      expect(matchClient.postMessage).toHaveBeenCalledWith({
        type: 'NOTIFICATION_CLICK',
        url: '/repos/1/sessions/s',
      })
      expect(matchClient.focus).toHaveBeenCalled()
      expect(focusedClient.postMessage).not.toHaveBeenCalled()
      expect(focusedClient.focus).not.toHaveBeenCalled()
      expect(scope.clients.openWindow).not.toHaveBeenCalled()
    })

    it('posts message to the focused client when no client matches the pathname', async () => {
      const focusedClient = makeClient({ url: 'http://localhost/repos/2', focused: true })
      const otherClient = makeClient({ url: 'http://localhost/repos/3' })
      scope.clients.matchAll.mockResolvedValue([otherClient, focusedClient])

      await dispatchAndWait('notificationclick', {
        notification: {
          close: vi.fn(),
          data: { url: '/repos/1/sessions/s' },
        },
      })

      expect(focusedClient.postMessage).toHaveBeenCalledWith({
        type: 'NOTIFICATION_CLICK',
        url: '/repos/1/sessions/s',
      })
      expect(focusedClient.focus).toHaveBeenCalled()
      expect(otherClient.postMessage).not.toHaveBeenCalled()
      expect(scope.clients.openWindow).not.toHaveBeenCalled()
    })

    it('opens a new window when there are no clients', async () => {
      scope.clients.matchAll.mockResolvedValue([])

      await dispatchAndWait('notificationclick', {
        notification: {
          close: vi.fn(),
          data: { url: '/repos/1/sessions/s' },
        },
      })

      expect(scope.clients.openWindow).toHaveBeenCalledWith('/repos/1/sessions/s')
    })

    it('ignores clients from other origins', async () => {
      const foreignClient = makeClient({ url: 'https://evil.example/repos/1/sessions/s' })
      foreignClient.postMessage = vi.fn()
      scope.clients.matchAll.mockResolvedValue([foreignClient])

      await dispatchAndWait('notificationclick', {
        notification: {
          close: vi.fn(),
          data: { url: '/repos/1/sessions/s' },
        },
      })

      expect(foreignClient.postMessage).not.toHaveBeenCalled()
      expect(scope.clients.openWindow).toHaveBeenCalledWith('/repos/1/sessions/s')
    })

    it('falls back to "/" when notification data url is missing', async () => {
      scope.clients.matchAll.mockResolvedValue([])

      await dispatchAndWait('notificationclick', {
        notification: {
          close: vi.fn(),
          data: {},
        },
      })

      expect(scope.clients.openWindow).toHaveBeenCalledWith('/')
    })
  })
})
