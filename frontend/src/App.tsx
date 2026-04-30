
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useRef, useCallback } from 'react'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { SessionDetail } from './pages/SessionDetail'
import { Memories } from './pages/Memories'
import { Schedules } from './pages/Schedules'
import { GlobalSchedules } from './pages/GlobalSchedules'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Setup } from './pages/Setup'
import { AssistantRedirect } from './pages/AssistantRedirect'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { VersionNotifier } from './components/VersionNotifier'
import { PwaUpdatePrompt } from '@/components/PwaUpdatePrompt'
import { MobileTabBar } from '@/components/navigation/MobileTabBar'
import { MobileSheetHost } from '@/components/navigation/MobileSheetHost'
import { DesktopSidebar } from '@/components/navigation/DesktopSidebar'
import { useTheme } from './hooks/useTheme'
import { useRightEdgeSwipe, useSwipeBack } from './hooks/useMobile'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { TTSProvider } from './contexts/TTSContext'
import { AuthProvider } from './contexts/AuthContext'
import { EventProvider, usePermissions, useEventContext } from '@/contexts/EventContext'
import { SwipeNavigationProvider } from '@/contexts/SwipeNavigationContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { SSHHostKeyDialog } from './components/ssh/SSHHostKeyDialog'
import { loginLoader, setupLoader, registerLoader, protectedLoader } from './lib/auth-loaders'
import { getSwipeBackTarget } from '@/lib/navigation'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 10,
      refetchOnWindowFocus: true,
    },
  },
})

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

function PermissionDialogWrapper() {
  const {
    current: currentPermission,
    pendingCount,
    respond: respondToPermission,
    showDialog,
    setShowDialog,
  } = usePermissions()

  return (
    <PermissionRequestDialog
      permission={currentPermission}
      pendingCount={pendingCount}
      isFromDifferentSession={false}
      onRespond={respondToPermission}
      open={showDialog}
      onOpenChange={setShowDialog}
      repoDirectory={null}
    />
  )
}

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const rootRef = useRef<HTMLDivElement>(null)
  const { open: openMobileSheet, openSheet } = useMobileTabBar()
  useTheme()

  const getRouteSwipeBackTarget = useCallback(
    () => getSwipeBackTarget(location.pathname, location.search),
    [location.pathname, location.search]
  )

  const canSwipeBack = useCallback(
    () => getRouteSwipeBackTarget() !== null,
    [getRouteSwipeBackTarget]
  )

  const handleSwipeBack = useCallback(() => {
    const target = getRouteSwipeBackTarget()
    if (target) navigate(target)
  }, [getRouteSwipeBackTarget, navigate])

  const { bind: bindRouteSwipe } = useSwipeBack(
    () => {},
    {
      enabled: true,
      suspendsRouteSwipe: false,
      canBack: canSwipeBack,
      onBack: handleSwipeBack,
    }
  )

  const canOpenMoreWithSwipe = () => {
    return /^\/repos\/[^/]+\/sessions\/[^/]+$/.test(location.pathname) && !openSheet
  }

  const { bind: bindMoreSwipe } = useRightEdgeSwipe(
    () => openMobileSheet('more'),
    {
      enabled: canOpenMoreWithSwipe(),
      edgeWidth: 32,
      threshold: 60,
    }
  )

  useEffect(() => {
    const cleanup = bindRouteSwipe(rootRef.current)
    return () => {
      cleanup?.()
    }
  }, [bindRouteSwipe])

  useEffect(() => {
    const cleanup = bindMoreSwipe(rootRef.current)
    return () => {
      cleanup?.()
    }
  }, [bindMoreSwipe])

  useEffect(() => {
    const channel = new BroadcastChannel('notification-click')
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { url?: string } | null | undefined
      if (typeof data?.url === 'string') {
        navigate(data.url)
      }
    }
    return () => channel.close()
  }, [navigate])

  return (
    <AuthProvider>
      <EventProvider>
        <div ref={rootRef} className="flex h-dvh w-full min-w-0">
          <DesktopSidebar />
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <Outlet />
          </div>
        </div>
        <MobileTabBar />
        <MobileSheetHost />
        <PermissionDialogWrapper />
        <SSHHostKeyDialogWrapper />
        <SettingsDialog />
        <VersionNotifier />
        <PwaUpdatePrompt />
        <Toaster
          position="bottom-right"
          expand={false}
          richColors
          closeButton
          duration={2500}
        />
      </EventProvider>
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        path: '/login',
        element: <Login />,
        loader: loginLoader,
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
        path: '/repos/:id/memories',
        element: <Memories />,
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
    ],
  },
])

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <SwipeNavigationProvider>
          <RouterProvider router={router} />
        </SwipeNavigationProvider>
      </TTSProvider>
    </QueryClientProvider>
  )
}

export default App
