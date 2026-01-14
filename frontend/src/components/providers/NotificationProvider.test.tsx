import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotificationProvider } from './NotificationProvider'
import { notificationEvents } from '@/lib/notificationEvents'

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}))

import { useNotifications } from '@/hooks/useNotifications'

const mockNotifySessionComplete = vi.fn()
const mockNotifyPermissionRequest = vi.fn()

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

describe('NotificationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isEnabled: true,
      config: undefined,
      requestPermission: vi.fn(),
      sendNotification: vi.fn(),
      notifySessionComplete: mockNotifySessionComplete,
      notifyPermissionRequest: mockNotifyPermissionRequest,
    })
  })

  it('should render children', () => {
    const { getByText } = render(
      <NotificationProvider>
        <div>Test Child</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    expect(getByText('Test Child')).toBeInTheDocument()
  })

  it('should subscribe to notification events on mount', () => {
    const subscribeSpy = vi.spyOn(notificationEvents, 'subscribe')

    render(
      <NotificationProvider>
        <div>Test</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    expect(subscribeSpy).toHaveBeenCalled()
    subscribeSpy.mockRestore()
  })

  it('should unsubscribe from notification events on unmount', () => {
    const unsubscribeMock = vi.fn()
    const subscribeSpy = vi.spyOn(notificationEvents, 'subscribe').mockReturnValue(unsubscribeMock)

    const { unmount } = render(
      <NotificationProvider>
        <div>Test</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    unmount()

    expect(unsubscribeMock).toHaveBeenCalled()
    subscribeSpy.mockRestore()
  })

  it('should call notifySessionComplete when session-complete event is emitted', () => {
    render(
      <NotificationProvider>
        <div>Test</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    act(() => {
      notificationEvents.emit({
        type: 'session-complete',
        sessionId: 'session-123',
        repoId: 'repo-1',
        sessionTitle: 'Test Session',
      })
    })

    expect(mockNotifySessionComplete).toHaveBeenCalledWith('session-123', 'repo-1', 'Test Session')
  })

  it('should call notifySessionComplete without title when not provided', () => {
    render(
      <NotificationProvider>
        <div>Test</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    act(() => {
      notificationEvents.emit({
        type: 'session-complete',
        sessionId: 'session-456',
      })
    })

    expect(mockNotifySessionComplete).toHaveBeenCalledWith('session-456', undefined, undefined)
  })

  it('should call notifyPermissionRequest when permission-request event is emitted', () => {
    render(
      <NotificationProvider>
        <div>Test</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    act(() => {
      notificationEvents.emit({
        type: 'permission-request',
        sessionId: 'session-789',
        repoId: 'repo-2',
        toolName: 'Write',
      })
    })

    expect(mockNotifyPermissionRequest).toHaveBeenCalledWith('session-789', 'repo-2', 'Write')
  })

  it('should handle multiple events', () => {
    render(
      <NotificationProvider>
        <div>Test</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    act(() => {
      notificationEvents.emit({
        type: 'session-complete',
        sessionId: 'session-1',
      })
      notificationEvents.emit({
        type: 'permission-request',
        sessionId: 'session-2',
        toolName: 'Bash',
      })
      notificationEvents.emit({
        type: 'session-complete',
        sessionId: 'session-3',
        repoId: 'repo-3',
        sessionTitle: 'Another Session',
      })
    })

    expect(mockNotifySessionComplete).toHaveBeenCalledTimes(2)
    expect(mockNotifyPermissionRequest).toHaveBeenCalledTimes(1)
    expect(mockNotifySessionComplete).toHaveBeenCalledWith('session-1', undefined, undefined)
    expect(mockNotifySessionComplete).toHaveBeenCalledWith('session-3', 'repo-3', 'Another Session')
    expect(mockNotifyPermissionRequest).toHaveBeenCalledWith('session-2', undefined, 'Bash')
  })

  it('should not call handlers after unmount', () => {
    const { unmount } = render(
      <NotificationProvider>
        <div>Test</div>
      </NotificationProvider>,
      { wrapper: createWrapper() }
    )

    unmount()

    act(() => {
      notificationEvents.emit({
        type: 'session-complete',
        sessionId: 'session-after-unmount',
      })
    })

    expect(mockNotifySessionComplete).not.toHaveBeenCalled()
  })
})
