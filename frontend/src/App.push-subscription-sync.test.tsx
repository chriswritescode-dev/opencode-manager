import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, createBrowserRouter: vi.fn(() => ({ routes: [] })) }
})

import { AppShell } from './App'

const mocks = vi.hoisted(() => ({
  usePushSubscriptionSessionSync: vi.fn(),
}))

vi.mock('@/hooks/usePushSubscriptionSessionSync', () => ({
  usePushSubscriptionSessionSync: mocks.usePushSubscriptionSessionSync,
}))

vi.mock('@/hooks/useMobile', () => ({
  useSwipeBack: () => ({ bind: () => () => {} }),
  useRightEdgeSwipe: () => ({ bind: () => () => {} }),
}))

vi.mock('@/hooks/useMobileTabBar', () => ({
  useMobileTabBar: () => ({ openSheet: null, open: vi.fn() }),
}))

vi.mock('@/contexts/SwipeNavigationContext', () => ({
  useSwipeNavigation: () => null,
}))

vi.mock('@/contexts/EventContext', () => ({
  EventProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  usePermissions: () => ({
    current: null,
    pendingCount: 0,
    respond: vi.fn(),
    showDialog: false,
    setShowDialog: vi.fn(),
    navigateToCurrent: vi.fn(),
    viewedSessionId: null,
    currentDirectory: null,
    currentIsFromDifferentSession: false,
  }),
  useEventContext: () => ({
    getRepoIdForSession: () => null,
    sshHostKey: { request: null, respond: vi.fn() },
  }),
}))

vi.mock('@/contexts/RepoWorktreesContext', () => ({
  RepoWorktreesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/contexts/KeyboardShortcutsContext', () => ({
  KeyboardShortcutsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/contexts/OpenCodeServerContext', () => ({
  OpenCodeServerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  isLocalOpenCodeServer: () => true,
}))

vi.mock('@/lib/serviceWorker', () => ({
  onNotificationClick: () => () => {},
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }))
vi.mock('@/hooks/useGlobalShortcutActions', () => ({ useGlobalShortcutActions: vi.fn() }))
vi.mock('@/hooks/useSidebarServerSelection', () => ({ useSidebarServerRouteSync: vi.fn() }))
vi.mock('@/hooks/useOpenCodeFailureToast', () => ({ useOpenCodeFailureToast: vi.fn() }))
vi.mock('@/hooks/useOpenCode', () => ({
  sessionQueryOptions: () => ({ queryKey: ['session'], queryFn: async () => null, enabled: false }),
}))
vi.mock('@/hooks/useOpenCodeServerActions', () => ({
  useOpenCodeServerActions: () => ({
    restartServerMutation: { isPending: false },
    confirmOpen: false,
    setConfirmOpen: vi.fn(),
    activeSessionCount: 0,
    requestRestart: vi.fn(),
    confirmRestart: vi.fn(),
  }),
}))

vi.mock('@/components/navigation/DesktopSidebar', () => ({ DesktopSidebar: () => null }))
vi.mock('@/components/navigation/MobileTabBar', () => ({ MobileTabBar: () => null }))
vi.mock('@/components/navigation/MobileSheetHost', () => ({ MobileSheetHost: () => null }))
vi.mock('@/components/settings/SettingsDialog', () => ({ SettingsDialog: () => null }))
vi.mock('@/components/settings/RestartServerDialog', () => ({ RestartServerDialog: () => null }))
vi.mock('@/components/session/PermissionRequestDialog', () => ({ PermissionRequestDialog: () => null }))
vi.mock('@/components/ssh/SSHHostKeyDialog', () => ({ SSHHostKeyDialog: () => null }))
vi.mock('@/components/VersionNotifier', () => ({ VersionNotifier: () => null }))
vi.mock('@/components/PwaUpdatePrompt', () => ({ PwaUpdatePrompt: () => null }))

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mounts the push subscription session sync in the authenticated shell', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(mocks.usePushSubscriptionSessionSync).toHaveBeenCalledTimes(1)
  })
})
