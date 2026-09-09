import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationSettings } from './NotificationSettings'
import { useNotifications } from '@/hooks/useNotifications'
import { showToast } from '@/lib/toast'
import type { PushSubscriptionRecord } from '@opencode-manager/shared/types'

vi.mock('@/hooks/useNotifications')
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}))

type NotificationsHook = ReturnType<typeof useNotifications>

const basePreferences = {
  enabled: true,
  events: {
    permissionAsked: true,
    questionAsked: false,
    sessionError: true,
    sessionIdle: false,
  },
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

function mockNotifications(overrides: Partial<NotificationsHook> = {}) {
  vi.mocked(useNotifications).mockReturnValue({
    isSupported: true,
    isAvailable: true,
    permission: 'granted',
    isEnabled: true,
    preferences: basePreferences,
    subscriptions: [deviceOne],
    isLoadingSubscriptions: false,
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    updateEventPreference: vi.fn(),
    removeDevice: vi.fn(),
    sendTest: vi.fn(),
    isSubscribing: false,
    isTesting: false,
    ...overrides,
  })
}

describe('NotificationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNotifications()
  })

  it('places main preferences and Registered Devices in a 2fr/1fr container-query grid', () => {
    const { container } = render(<NotificationSettings />)

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('@container', 'w-full', 'max-w-7xl')

    const layout = root.firstElementChild as HTMLElement
    expect(layout).toHaveClass('grid', '@min-[1000px]:grid-cols-[2fr_1fr]', '@min-[1000px]:items-start')

    const [preferencesPanel, devicesPanel] = Array.from(layout.children) as HTMLElement[]
    expect(preferencesPanel).toHaveClass('min-w-0')
    expect(within(preferencesPanel).getByRole('heading', { name: 'Push Notifications' })).toBeInTheDocument()
    expect(devicesPanel).toHaveClass('min-w-0')
    expect(within(devicesPanel).getByRole('heading', { name: 'Registered Devices' })).toBeInTheDocument()
  })

  it('renders the preference toggles as compact divider rows', () => {
    const { container } = render(<NotificationSettings />)

    const rows = container.querySelector('.divide-y') as HTMLElement
    expect(rows).toHaveClass('divide-border')
    expect(rows.querySelector('.border, .p-4')).toBeNull()

    expect(screen.getByRole('switch', { name: 'Enable push notifications' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Permission requests' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Agent questions' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Session errors' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Session completion' })).not.toBeChecked()
  })

  it('writes event preferences and disable through the hook', async () => {
    const user = userEvent.setup()
    const enable = vi.fn().mockResolvedValue(undefined)
    const disable = vi.fn().mockResolvedValue(undefined)
    const updateEventPreference = vi.fn()
    mockNotifications({ enable, disable, updateEventPreference })
    render(<NotificationSettings />)

    await user.click(screen.getByRole('switch', { name: 'Agent questions' }))
    expect(updateEventPreference).toHaveBeenCalledWith('questionAsked', true)

    await user.click(screen.getByRole('switch', { name: 'Session completion' }))
    expect(updateEventPreference).toHaveBeenCalledWith('sessionIdle', true)

    await user.click(screen.getByRole('switch', { name: 'Enable push notifications' }))
    expect(disable).toHaveBeenCalledTimes(1)
    expect(enable).not.toHaveBeenCalled()
  })

  it('enables push notifications when the switch is turned on', async () => {
    const user = userEvent.setup()
    const enable = vi.fn().mockResolvedValue(undefined)
    mockNotifications({ isEnabled: false, enable })
    render(<NotificationSettings />)

    await user.click(screen.getByRole('switch', { name: 'Enable push notifications' }))

    expect(enable).toHaveBeenCalledTimes(1)
  })

  it('sends a test notification only when devices are registered and toasts the result', async () => {
    const user = userEvent.setup()
    const sendTest = vi.fn() as unknown as NotificationsHook['sendTest']
    mockNotifications({ sendTest })
    const { unmount } = render(<NotificationSettings />)

    const testButton = screen.getByRole('button', { name: 'Send test notification' })
    expect(testButton).toBeEnabled()
    await user.click(testButton)
    expect(sendTest).toHaveBeenCalledTimes(1)

    const config = (sendTest as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      onSuccess: (data: { devicesNotified: number }) => void
    }
    config.onSuccess({ devicesNotified: 2 })
    expect(vi.mocked(showToast.success)).toHaveBeenCalledWith('Test notification sent to 2 device(s)')

    unmount()

    mockNotifications({
      subscriptions: [],
      sendTest: vi.fn() as unknown as NotificationsHook['sendTest'],
    })
    render(<NotificationSettings />)

    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeDisabled()
  })

  it('removes a registered device from the devices panel', async () => {
    const user = userEvent.setup()
    const removeDevice = vi.fn()
    mockNotifications({ removeDevice })
    render(<NotificationSettings />)

    const deviceRow = screen.getByText('Chris MacBook').closest('div.justify-between') as HTMLElement
    await user.click(within(deviceRow).getByRole('button'))

    expect(removeDevice).toHaveBeenCalledWith(1)
  })

  it('renders the denied permission and unsupported browser states', () => {
    mockNotifications({ permission: 'denied' })
    const { unmount } = render(<NotificationSettings />)
    expect(screen.getByText(/permission was denied/i)).toBeInTheDocument()
    unmount()

    mockNotifications({ isSupported: false })
    render(<NotificationSettings />)
    expect(screen.getByText(/not supported in this browser/i)).toBeInTheDocument()
  })
})
