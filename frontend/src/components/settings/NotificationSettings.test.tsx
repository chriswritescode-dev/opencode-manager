import { describe, it, expect } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@opencode-manager/shared/schemas'
import type { PushSubscriptionRecord } from '@opencode-manager/shared/types'
import { NotificationSettings } from './NotificationSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { installNotification, installServiceWorker, installServiceWorkerPushSubscription } from '@/test/browserFakes'
import type { FetchFake, FetchRoute } from '@/test/fetchFake'
import type { NotificationPreferences } from '@/api/types/settings'

interface NotificationsServerOptions {
  enabled?: boolean
  subscriptions?: PushSubscriptionRecord[]
}

const deviceOne: PushSubscriptionRecord = {
  id: 1,
  userId: 'default',
  endpoint: 'https://push.example.com/one',
  p256dh: 'key',
  auth: 'auth',
  deviceName: 'Chris MacBook',
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
}

function notificationPreferences(enabled: boolean): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    enabled,
    events: { ...DEFAULT_NOTIFICATION_PREFERENCES.events, questionAsked: false },
  }
}

async function renderNotifications(options: NotificationsServerOptions = {}) {
  const enabled = options.enabled ?? true
  let subscriptions = options.subscriptions ?? [deviceOne]
  const settings = createSettingsServer({ notifications: notificationPreferences(enabled) })
  const fetchRoutes: FetchRoute[] = [
    ...settings.routes,
    { method: 'GET', path: '/api/notifications/vapid-public-key', respond: () => ({ json: { publicKey: 'vapid-key' } }) },
    { method: 'GET', path: '/api/notifications/subscriptions', respond: () => ({ json: { subscriptions } }) },
    {
      method: 'DELETE',
      path: '/api/notifications/subscriptions/:id',
      respond: (_request, params) => {
        subscriptions = subscriptions.filter((subscription) => String(subscription.id) !== params.id)
        return { json: { success: true } }
      },
    },
    { method: 'POST', path: '/api/notifications/test', respond: () => ({ json: { success: true, devicesNotified: 2 } }) },
    { method: 'POST', path: '/api/notifications/subscribe', respond: () => ({ json: { subscription: deviceOne } }) },
    { method: 'DELETE', path: '/api/notifications/subscribe', respond: () => ({ json: { success: true } }) },
  ]
  const result = renderWithProviders(<NotificationSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
  await waitFor(() =>
    expect(result.fetchFake.findRequests('GET', '/api/settings')).toHaveLength(1),
  )
  await waitFor(() =>
    expect(result.fetchFake.findRequests('GET', '/api/notifications/vapid-public-key')).toHaveLength(1),
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return result
}

function patchBodies(fetchFake: FetchFake) {
  return fetchFake.findRequests('PATCH', '/api/settings').map((request) => request.body)
}

describe('NotificationSettings', () => {
  it('places main preferences and Registered Devices in a 2fr/1fr container-query grid', async () => {
    installNotification('granted')
    installServiceWorker()
    const { container } = await renderNotifications()
    await screen.findByRole('switch', { name: 'Enable push notifications' })

    const root = container.querySelector('div[class*="@container"]')
    if (!(root instanceof HTMLElement)) throw new Error('root not found')
    expect(root).toHaveClass('@container', 'w-full', 'max-w-7xl')
    const layout = root.firstElementChild
    if (!(layout instanceof HTMLElement)) throw new Error('layout not found')
    expect(layout).toHaveClass('grid', '@min-[1000px]:grid-cols-[2fr_1fr]', '@min-[1000px]:items-start')

    const [preferencesPanel, devicesPanel] = Array.from(layout.children)
    expect(preferencesPanel).toHaveClass('min-w-0')
    if (!(preferencesPanel instanceof HTMLElement)) throw new Error('preferences panel not found')
    expect(within(preferencesPanel).getByRole('heading', { name: 'Push Notifications' })).toBeInTheDocument()
    expect(devicesPanel).toHaveClass('min-w-0')
    if (!(devicesPanel instanceof HTMLElement)) throw new Error('devices panel not found')
    expect(within(devicesPanel).getByRole('heading', { name: 'Registered Devices' })).toBeInTheDocument()
  })

  it('renders the preference toggles as compact divider rows', async () => {
    installNotification('granted')
    installServiceWorker()
    const { container } = await renderNotifications()
    await screen.findByRole('switch', { name: 'Enable push notifications' })

    const rows = container.querySelector('.divide-y')
    expect(rows).toHaveClass('divide-border')
    expect(rows?.querySelector('.border, .p-4')).toBeNull()

    expect(screen.getByRole('switch', { name: 'Enable push notifications' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Permission requests' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Agent questions' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Session errors' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Session completion' })).not.toBeChecked()
  })

  it('writes event preferences and disable through the hook', async () => {
    installNotification('granted')
    installServiceWorker()
    const user = userEvent.setup()
    const { fetchFake } = await renderNotifications()

    await user.click(await screen.findByRole('switch', { name: 'Agent questions' }))
    await waitFor(() => expect(patchBodies(fetchFake)).toHaveLength(1))
    expect(patchBodies(fetchFake)[0]).toMatchObject({
      preferences: { notifications: { enabled: true, events: { questionAsked: true } } },
    })

    await user.click(screen.getByRole('switch', { name: 'Session completion' }))
    await waitFor(() => expect(patchBodies(fetchFake)).toHaveLength(2))
    expect(patchBodies(fetchFake)[1]).toMatchObject({
      preferences: { notifications: { events: { sessionIdle: true } } },
    })

    await user.click(screen.getByRole('switch', { name: 'Enable push notifications' }))

    await waitFor(() => expect(patchBodies(fetchFake)).toHaveLength(3))
    expect(patchBodies(fetchFake)[2]).toMatchObject({ preferences: { notifications: { enabled: false } } })
    expect(await screen.findByText('Push notifications disabled')).toBeInTheDocument()
  })

  it('enables push notifications when the switch is turned on', async () => {
    installNotification('granted')
    installServiceWorkerPushSubscription()
    const user = userEvent.setup()
    const { fetchFake } = await renderNotifications({ enabled: false })

    await user.click(screen.getByRole('switch', { name: 'Enable push notifications' }))

    expect(await screen.findByText('Push notifications enabled')).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', '/api/notifications/subscribe')).toHaveLength(1)
    expect(patchBodies(fetchFake).at(-1)).toMatchObject({ preferences: { notifications: { enabled: true } } })
  })

  it('sends a test notification only when devices are registered and toasts the result', async () => {
    installNotification('granted')
    installServiceWorker()
    const user = userEvent.setup()
    await renderNotifications()

    const testButton = await screen.findByRole('button', { name: 'Send test notification' })
    expect(testButton).toBeEnabled()
    await user.click(testButton)

    expect(await screen.findByText('Test notification sent to 2 device(s)')).toBeInTheDocument()
  })

  it('disables the test notification button when no devices are registered', async () => {
    installNotification('granted')
    installServiceWorker()
    await renderNotifications({ subscriptions: [] })

    expect(await screen.findByText('No devices registered for push notifications.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeDisabled()
  })

  it('removes a registered device from the devices panel', async () => {
    installNotification('granted')
    installServiceWorker()
    const user = userEvent.setup()
    const { fetchFake } = await renderNotifications()

    const deviceRow = (await screen.findByText('Chris MacBook')).closest('div.justify-between')
    if (!(deviceRow instanceof HTMLElement)) throw new Error('device row not found')
    await user.click(within(deviceRow).getByRole('button'))

    await waitFor(() =>
      expect(fetchFake.findRequests('DELETE', '/api/notifications/subscriptions/:id')).toHaveLength(1),
    )
    await waitFor(() => expect(screen.queryByText('Chris MacBook')).not.toBeInTheDocument())
  })

  it('renders the denied permission state', async () => {
    installNotification('denied')
    installServiceWorker()
    await renderNotifications()

    expect(await screen.findByText(/permission was denied/i)).toBeInTheDocument()
  })

  it('renders the unsupported browser state', async () => {
    installServiceWorker()
    await renderNotifications()

    expect(await screen.findByText(/not supported in this browser/i)).toBeInTheDocument()
  })

  it('writes the goal outcome preference and defaults it on', async () => {
    installNotification('granted')
    installServiceWorker()
    const user = userEvent.setup()
    const { fetchFake } = await renderNotifications()

    const toggle = await screen.findByRole('switch', { name: 'Goal outcomes' })
    expect(toggle).toBeChecked()

    await user.click(toggle)

    await waitFor(() => expect(patchBodies(fetchFake)).toHaveLength(1))
    expect(patchBodies(fetchFake)[0]).toMatchObject({
      preferences: { notifications: { events: { goalOutcome: false } } },
    })
  })
})

describe('NotificationSettings subscriptions', () => {
  it('does not request subscriptions without notification permission', async () => {
    installNotification('denied')
    installServiceWorker()
    const { fetchFake } = await renderNotifications()

    expect(fetchFake.findRequests('GET', '/api/notifications/subscriptions')).toHaveLength(0)
  })
})
