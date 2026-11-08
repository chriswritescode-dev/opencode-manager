
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider, Outlet, useNavigate, useParams, Navigate } from 'react-router-dom'
import { useEffect, useRef, type ReactNode } from 'react'
import { DEVICE_PAIRING_PATH, LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { LinkedServerRedirect } from './pages/LinkedServerRedirect'
import { RemoteProject } from './pages/RemoteProject'
import { SessionDetail } from './pages/SessionDetail'
import { Schedules } from './pages/Schedules'
import { GlobalSchedules } from './pages/GlobalSchedules'
import { Login } from './pages/Login'
import { Pair } from './pages/Pair'
import { Register } from './pages/Register'
import { Setup } from './pages/Setup'
import { AssistantRedirect } from './pages/AssistantRedirect'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { VersionNotifier } from './components/VersionNotifier'
import { PwaUpdatePrompt } from '@/components/PwaUpdatePrompt'
import { MobileTabBar } from '@/components/navigation/MobileTabBar'
import { MobileSheetHost } from '@/components/navigation/MobileSheetHost'
import { SideMenu, useSideMenuOffset } from '@/components/navigation/SideMenu'
import { RouteErrorBoundary } from '@/components/ui/route-error-boundary'
import { NotFoundState } from '@/components/ui/not-found-state'
import { DesktopSidebar } from '@/components/navigation/DesktopSidebar'
import { useLeftEdgeSwipe, useMobile } from './hooks/useMobile'
import { useSideMenu } from '@/hooks/useSideMenu'
import { TTSProvider } from './contexts/TTSContext'
import { ThemeProvider, useThemeMode } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { QueryCachePersistenceProvider } from './contexts/QueryCachePersistenceContext'
import { KeyboardShortcutsProvider } from './contexts/KeyboardShortcutsContext'
import { EventProvider, usePermissions, useEventContext } from '@/contexts/EventContext'
import { OpenCodeServerProvider, isLocalOpenCodeServer, useRouteOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { RepoWorktreesProvider } from '@/contexts/RepoWorktreesContext'
import { SwipeNavigationProvider, useSwipeNavigation } from '@/contexts/SwipeNavigationContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { SSHHostKeyDialog } from './components/ssh/SSHHostKeyDialog'
import { loginLoader, setupLoader, registerLoader, protectedLoader } from './lib/auth-loaders'
import { MODAL_TRANSITION_MS } from '@/lib/utils'
import { onNotificationClick } from '@/lib/serviceWorker'
import { applyPersistedQueryDefaults } from '@/lib/queryPersistence'
import { useAuth } from '@/hooks/useAuth'
import { useOpenCodeFailureToast } from '@/hooks/useOpenCodeFailureToast'
import { useOpenCodeServerActions } from '@/hooks/useOpenCodeServerActions'
import { useGlobalShortcutActions } from '@/hooks/useGlobalShortcutActions'
import { useSidebarServerRouteSync } from '@/hooks/useSidebarServerSelection'
import { usePushSubscriptionSessionSync } from '@/hooks/usePushSubscriptionSessionSync'
import { installConnectivityMonitor, useConnectivityStore } from '@/stores/connectivityStore'
import { sessionQueryOptions } from '@/hooks/useOpenCode'
import { RestartServerDialog } from '@/components/settings/RestartServerDialog'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 10,
      refetchOnWindowFocus: true,
    },
  },
})

applyPersistedQueryDefaults(queryClient)

function SSHHostKeyDialogWrapper() {
  const { sshHostKey } = useEventContext()
  return (
    <SSHHostKeyDialog
      request={sshHostKey.request}
      onRespond={async (requestId, response) => {
        await sshHostKey.respond(requestId, response === 'accept')
      }}
    />
  )
}

function ThemedToaster() {
  const themeMode = useThemeMode()
  return (
    <Toaster
      theme={themeMode ?? 'light'}
      position="bottom-right"
      expand={false}
      richColors
      closeButton
      duration={2500}
    />
  )
}

function HealthMonitor() {
  const { isAuthenticated } = useAuth()
  const {
    restartServerMutation,
    confirmOpen,
    setConfirmOpen,
    activeSessionCount,
    requestRestart,
    confirmRestart,
  } = useOpenCodeServerActions()
  useOpenCodeFailureToast(isAuthenticated, requestRestart)
  return (
    <RestartServerDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      activeSessionCount={activeSessionCount}
      isRestarting={restartServerMutation.isPending}
      onCancel={() => setConfirmOpen(false)}
      onConfirm={confirmRestart}
    />
  )
}

export function PermissionDialogWrapper() {
  const {
    current: currentPermission,
    pendingCount,
    respond: replyToPermission,
    showDialog,
    setShowDialog,
    navigateToCurrent,
    viewedSessionId,
    currentDirectory,
    currentIsFromDifferentSession,
  } = usePermissions()
  const { getRepoIdForSession } = useEventContext()
  const isRemotePermission = currentPermission !== null && !isLocalOpenCodeServer(currentPermission.serverId)
  const { data: session } = useQuery(
    sessionQueryOptions(
      currentPermission?.sessionID,
      currentDirectory ?? undefined,
      currentPermission?.serverId ?? LOCAL_OPENCODE_SERVER_ID,
    ),
  )

  const canOpenCurrentSession = currentPermission !== null
    && (isRemotePermission || getRepoIdForSession(currentPermission.sessionID) !== null)
    && (currentIsFromDifferentSession || viewedSessionId === null)

  return (
    <PermissionRequestDialog
      permission={currentPermission}
      pendingCount={pendingCount}
      isFromDifferentSession={currentIsFromDifferentSession}
      sessionTitle={session?.title ?? undefined}
      repoDirectory={currentDirectory}
      onOpenSession={canOpenCurrentSession ? navigateToCurrent : undefined}
      onRespond={replyToPermission}
      open={showDialog}
      onOpenChange={setShowDialog}
    />
  )
}

function GlobalShortcuts() {
  useGlobalShortcutActions()
  return null
}

function SidebarServerRouteSync() {
  useSidebarServerRouteSync()
  return null
}

function PushSubscriptionSessionSync() {
  usePushSubscriptionSessionSync()
  return null
}

function ConnectivityMonitor() {
  const { user } = useAuth()
  const serverId = useRouteOpenCodeServerId()

  useEffect(() => installConnectivityMonitor(), [])

  useEffect(() => {
    useConnectivityStore.getState().clearInterrupted()
  }, [user?.id, serverId])

  return null
}

function ServerScope({ children }: { children: ReactNode }) {
  const { serverId } = useParams<{ serverId: string }>()

  if (!serverId || serverId === LOCAL_OPENCODE_SERVER_ID) {
    return <Navigate to="/" replace />
  }

  return <OpenCodeServerProvider serverId={serverId}>{children}</OpenCodeServerProvider>
}

function RootLayout() {
  return (
    <AuthProvider>
      <QueryCachePersistenceProvider>
        <ThemeProvider>
          <TTSProvider>
            <ThemedToaster />
            <Outlet />
          </TTSProvider>
        </ThemeProvider>
      </QueryCachePersistenceProvider>
    </AuthProvider>
  )
}

export function AppShell() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const isMobile = useMobile()
  const { isOpen, openMenu } = useSideMenu()
  const menuOffset = useSideMenuOffset(isMobile)
  const swipeNav = useSwipeNavigation()

  const { bind: bindLeftEdgeSwipe } = useLeftEdgeSwipe(
    () => openMenu({ page: 'home' }),
    { enabled: isMobile && !isOpen && !(swipeNav?.isSuspended() ?? false) }
  )

  useEffect(() => {
    const cleanup = bindLeftEdgeSwipe(rootRef.current)
    return () => {
      cleanup?.()
    }
  }, [bindLeftEdgeSwipe])

  useEffect(
    () =>
      onNotificationClick((url) => {
        if (window.location.pathname + window.location.search !== url) navigate(url)
      }),
    [navigate]
  )

  return (
    <EventProvider>
      <RepoWorktreesProvider>
        <KeyboardShortcutsProvider>
          <GlobalShortcuts />
          <SidebarServerRouteSync />
          <PushSubscriptionSessionSync />
          <ConnectivityMonitor />
          <div className="flex h-dvh w-full min-w-0 flex-col overflow-hidden">
            <PwaUpdatePrompt />
            <div
              ref={rootRef}
              className="flex flex-1 min-h-0 w-full min-w-0"
              style={{
                transform: `translateX(${menuOffset})`,
                transition: `transform ${MODAL_TRANSITION_MS}ms ease-out`,
              }}
            >
              <DesktopSidebar />
              <main className="flex-1 min-w-0 min-h-0 flex flex-col">
                <Outlet />
              </main>
            </div>
          </div>
          <MobileTabBar />
          <MobileSheetHost />
          <SideMenu />
          <PermissionDialogWrapper />
          <SSHHostKeyDialogWrapper />
          <SettingsDialog />
          <HealthMonitor />
          <VersionNotifier />
        </KeyboardShortcutsProvider>
      </RepoWorktreesProvider>
    </EventProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: '/login',
        element: <Login />,
        loader: loginLoader,
      },
      {
        path: DEVICE_PAIRING_PATH,
        element: <Pair />,
      },
      {
        path: '/register',
        element: <Register />,
        loader: registerLoader,
      },
      {
        path: '/setup',
        element: <Setup />,
        loader: setupLoader,
      },
      {
        element: <AppShell />,
        errorElement: <RouteErrorBoundary />,
        children: [
          {
            path: '/',
            element: <Repos />,
            loader: protectedLoader,
          },
          {
            path: '/assistant',
            element: <AssistantRedirect />,
            loader: protectedLoader,
          },
          {
            path: '/repos/:id',
            element: <RepoDetail />,
            loader: protectedLoader,
          },
          {
            path: '/repos/:id/assistant',
            element: <AssistantRedirect />,
            loader: protectedLoader,
          },
          {
            path: '/repos/:id/sessions/:sessionId',
            element: <SessionDetail />,
            loader: protectedLoader,
          },
          {
            path: '/repos/:id/schedules',
            element: <Schedules />,
            loader: protectedLoader,
          },
          {
            path: '/schedules',
            element: <GlobalSchedules />,
            loader: protectedLoader,
          },
          {
            path: '/servers/:serverId',
            element: <LinkedServerRedirect />,
            loader: protectedLoader,
          },
          {
            path: '/servers/:serverId/projects',
            element: (
              <ServerScope>
                <RemoteProject />
              </ServerScope>
            ),
            loader: protectedLoader,
          },
          {
            path: '/servers/:serverId/sessions/:sessionId',
            element: (
              <ServerScope>
                <SessionDetail />
              </ServerScope>
            ),
            loader: protectedLoader,
          },
          {
            path: '*',
            element: (
              <NotFoundState
                title="Page Not Found"
                message="The page you are looking for does not exist."
                backTo="/"
                backLabel="Go home"
              />
            ),
            loader: protectedLoader,
          },
        ],
      },
    ],
  },
])

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SwipeNavigationProvider>
        <RouterProvider router={router} />
      </SwipeNavigationProvider>
    </QueryClientProvider>
  )
}

export default App
