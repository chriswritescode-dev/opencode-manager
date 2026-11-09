import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, createBrowserRouter: vi.fn(() => ({ routes: [] })) }
})

const serviceWorkerMocks = vi.hoisted(() => ({
  notificationHandler: { current: null as ((url: string) => void) | null },
}))

vi.mock('@/lib/serviceWorker', () => ({
  onNotificationClick: (handler: (url: string) => void) => {
    serviceWorkerMocks.notificationHandler.current = handler
    return () => {}
  },
}))

import { AppShell } from './App'
import { ProjectHubRedirect } from '@/components/navigation/ProjectHubRedirect'
import { parseProjectTarget } from '@/lib/projectTarget'

vi.mock('@/hooks/usePushSubscriptionSessionSync', () => ({
  usePushSubscriptionSessionSync: vi.fn(),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: () => true,
  usePanelSwipeClose: () => ({ bind: () => () => {} }),
  useLeftEdgeSwipe: () => ({ bind: () => () => {} }),
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
  useForms: () => ({
    pendingCount: 0,
    pendingSessionIDs: [],
    navigateToCurrent: vi.fn(),
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
  useShortcutActions: vi.fn(),
}))

vi.mock('@/contexts/OpenCodeServerContext', () => ({
  OpenCodeServerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  isLocalOpenCodeServer: () => true,
  useRouteOpenCodeServerId: () => 'local',
  useOpenCodeServerId: () => LOCAL_OPENCODE_SERVER_ID,
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }))
vi.mock('@/hooks/useGlobalShortcutActions', () => ({ useGlobalShortcutActions: vi.fn() }))
vi.mock('@/hooks/useSidebarServerSelection', () => ({
  useSidebarServerRouteSync: vi.fn(),
  useSidebarServerSelection: () => [LOCAL_OPENCODE_SERVER_ID, vi.fn()],
}))
vi.mock('@/hooks/useSchedules', () => ({ useUnreadScheduleRuns: () => ({ data: undefined }) }))
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

vi.mock('@/components/navigation/SideMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/navigation/SideMenu')>()
  return { ...actual, SideMenu: () => null }
})
vi.mock('@/components/navigation/DesktopSidebar', () => ({ DesktopSidebar: () => null }))
vi.mock('@/components/navigation/MobileTabBar', () => ({ MobileTabBar: () => null }))
vi.mock('@/components/navigation/MobileSheetHost', () => ({ MobileSheetHost: () => null }))
vi.mock('@/components/settings/SettingsDialog', () => ({ SettingsDialog: () => null }))
vi.mock('@/components/settings/RestartServerDialog', () => ({ RestartServerDialog: () => null }))
vi.mock('@/components/session/PermissionRequestDialog', () => ({ PermissionRequestDialog: () => null }))
vi.mock('@/components/ssh/SSHHostKeyDialog', () => ({ SSHHostKeyDialog: () => null }))
vi.mock('@/components/VersionNotifier', () => ({ VersionNotifier: () => null }))
vi.mock('@/components/PwaUpdatePrompt', () => ({ PwaUpdatePrompt: () => null }))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<LocationProbe />} />
            <Route path="/repos/:id" element={<ProjectHubRedirect />} />
            <Route path="/servers/:serverId/projects" element={<ProjectHubRedirect />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell notification click', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceWorkerMocks.notificationHandler.current = null
  })

  it('lands a repo notification URL on the Home side-menu hub for that repo', async () => {
    renderApp()

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    const handler = serviceWorkerMocks.notificationHandler.current
    expect(handler).not.toBeNull()

    await act(async () => {
      handler?.('/repos/5')
    })

    await waitFor(() => {
      const text = screen.getByTestId('location').textContent ?? ''
      expect(text.startsWith('/?menu=sessions&menuProject=')).toBe(true)
      expect(text.slice(0, text.indexOf('?'))).toBe('/')
      const params = new URLSearchParams(text.slice(text.indexOf('?')))
      expect(parseProjectTarget(params.get('menuProject'))).toEqual({ kind: 'repo', repoId: 5 })
    })
  })
})
