
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
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
import { useSwipeBack } from './hooks/useMobile'
import { TTSProvider } from './contexts/TTSContext'
import { AuthProvider } from './contexts/AuthContext'
import { EventProvider, usePermissions, useEventContext } from '@/contexts/EventContext'
import { SwipeNavigationProvider } from '@/contexts/SwipeNavigationContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { SSHHostKeyDialog } from './components/ssh/SSHHostKeyDialog'
import { loginLoader, setupLoader, registerLoader, protectedLoader } from './lib/auth-loaders'

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
  useTheme()

  const getSwipeBackTarget = () => {
    const path = location.pathname
    if (path.match(/^\/repos\/[^/]+\/sessions\/[^/]+$/)) {
      const repoId = path.split('/')[2]
      return `/repos/${repoId}`
    }
    if (path.match(/^\/repos\/[^/]+$/)) {
      return '/'
    }
    if (path.match(/^\/repos\/[^/]+\/memories$/)) {
      const repoId = path.split('/')[2]
      return `/repos/${repoId}`
    }
    if (path.match(/^\/repos\/[^/]+\/schedules$/)) {
      const repoId = path.split('/')[2]
      return `/repos/${repoId}`
    }
    if (path === '/schedules') {
      return '/'
    }
    return null
  }

  const canSwipeBack = () => {
    const path = location.pathname
    return !['/login', '/setup', '/register', '/'].includes(path) && getSwipeBackTarget() !== null
  }

  const handleSwipeBack = () => {
    const target = getSwipeBackTarget()
    if (target) {
      navigate(target)
    }
  }

  const { bind: bindRouteSwipe } = useSwipeBack(
    () => {},
    {
      enabled: true,
      suspendsRouteSwipe: false,
      canBack: canSwipeBack,
      onBack: handleSwipeBack,
    }
  )

  useEffect(() => {
    const cleanup = bindRouteSwipe(rootRef.current)
    return () => {
      cleanup?.()
    }
  }, [bindRouteSwipe])

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
