import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationSettings } from './NotificationSettings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { useNotifications } from '@/hooks/useNotifications'

const mockUpdateSettings = vi.fn()
const mockRequestPermission = vi.fn()

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('NotificationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render notifications heading', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  it('should show "Not supported" when notifications are not supported', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: false,
      permission: 'denied',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Not supported')).toBeInTheDocument()
  })

  it('should show "Not requested" when permission is default', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Not requested')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument()
  })

  it('should show "Allowed" when permission is granted', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: true,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: true,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Allowed')).toBeInTheDocument()
  })

  it('should show "Blocked" when permission is denied', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'denied',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Blocked in browser' })).toBeDisabled()
  })

  it('should call requestPermission when enable button is clicked', async () => {
    const user = userEvent.setup()

    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    await user.click(screen.getByRole('button', { name: 'Enable notifications' }))

    expect(mockRequestPermission).toHaveBeenCalled()
  })

  it('should disable enable toggle when permission is not granted', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    const toggle = screen.getByRole('switch', { name: 'Enable Notifications' })
    expect(toggle).toBeDisabled()
  })

  it('should enable toggle when permission is granted', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    const toggle = screen.getByRole('switch', { name: 'Enable Notifications' })
    expect(toggle).not.toBeDisabled()
  })

  it('should call updateSettings when enable toggle is clicked', async () => {
    const user = userEvent.setup()

    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    await user.click(screen.getByRole('switch', { name: 'Enable Notifications' }))

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      notifications: expect.objectContaining({
        enabled: true,
      }),
    })
  })

  it('should show additional options when notifications are enabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: true,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: true,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Session Complete')).toBeInTheDocument()
    expect(screen.getByText('Permission Requests')).toBeInTheDocument()
    expect(screen.getByText('Sound')).toBeInTheDocument()
  })

  it('should not show additional options when notifications are disabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.queryByText('Session Complete')).not.toBeInTheDocument()
    expect(screen.queryByText('Permission Requests')).not.toBeInTheDocument()
    expect(screen.queryByText('Sound')).not.toBeInTheDocument()
  })

  it('should update sessionComplete setting when toggled', async () => {
    const user = userEvent.setup()

    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: true,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: true,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    await user.click(screen.getByRole('switch', { name: 'Session Complete' }))

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      notifications: expect.objectContaining({
        sessionComplete: false,
      }),
    })
  })

  it('should update permissionRequests setting when toggled', async () => {
    const user = userEvent.setup()

    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: true,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: true,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    await user.click(screen.getByRole('switch', { name: 'Permission Requests' }))

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      notifications: expect.objectContaining({
        permissionRequests: false,
      }),
    })
  })

  it('should update sound setting when toggled', async () => {
    const user = userEvent.setup()

    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: true,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: true,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    await user.click(screen.getByRole('switch', { name: 'Sound' }))

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      notifications: expect.objectContaining({
        sound: true,
      }),
    })
  })

  it('should show blocked message when permission is denied', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        notifications: {
          enabled: false,
          sessionComplete: true,
          permissionRequests: true,
          sound: false,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'denied',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText(/Notifications are blocked/)).toBeInTheDocument()
  })

  it('should use default config when preferences are undefined', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: undefined,
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isEnabled: false,
      config: undefined,
      requestPermission: mockRequestPermission,
      sendNotification: vi.fn(),
      notifySessionComplete: vi.fn(),
      notifyPermissionRequest: vi.fn(),
    })

    render(<NotificationSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })
})
