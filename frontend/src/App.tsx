import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { SessionDetail } from './pages/SessionDetail'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Setup } from './pages/Setup'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { useTheme } from './hooks/useTheme'
import { TTSProvider } from './contexts/TTSContext'
import { AuthProvider } from './contexts/AuthContext'
import { EventProvider, usePermissions } from '@/contexts/EventContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { loginLoader, setupLoader, registerLoader, protectedLoader } from './lib/auth-loaders'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 10,
      refetchOnWindowFocus: true,
    },
  },
})

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
  useTheme()

  useEffect(() => {
    const loader = document.getElementById('app-loader')
    if (loader) {
      loader.style.transition = 'opacity 0.2s ease-out'
      loader.style.opacity = '0'
      setTimeout(() => loader.remove(), 200)
    }
  }, [])

  return (
    <AuthProvider>
      <EventProvider>
        <Outlet />
        <PermissionDialogWrapper />
        <SettingsDialog />
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
        path: '/repos/:id',
        element: <RepoDetail />,
        loader: protectedLoader,
      },
      {
        path: '/repos/:id/sessions/:sessionId',
        element: <SessionDetail />,
        loader: protectedLoader,
      },
    ],
  },
])

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <RouterProvider router={router} />
      </TTSProvider>
    </QueryClientProvider>
  )
}

export default App
