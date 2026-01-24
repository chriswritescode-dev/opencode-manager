import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { SessionDetail } from './pages/SessionDetail'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { useSettingsDialog } from './hooks/useSettingsDialog'
import { useTheme } from './hooks/useTheme'
import { TTSProvider } from './contexts/TTSContext'
import { AuthProvider } from './contexts/AuthContext'
import { EventProvider, usePermissions } from '@/contexts/EventContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { ProtectedRoute } from './components/auth/ProtectedRoute'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 10,
      refetchOnWindowFocus: true,
    },
  },
})

function RouterContent() {
  const { isOpen, close } = useSettingsDialog()
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
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Repos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/repos/:id"
          element={
            <ProtectedRoute>
              <RepoDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/repos/:id/sessions/:sessionId"
          element={
            <ProtectedRoute>
              <SessionDetail />
            </ProtectedRoute>
          }
        />
      </Routes>
      <SettingsDialog open={isOpen} onOpenChange={close} />
      <Toaster
        position="bottom-right"
        expand={false}
        richColors
        closeButton
        duration={2500}
      />
    </>
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <BrowserRouter>
          <AuthProvider>
            <EventProvider>
              <RouterContent />
              <PermissionDialogWrapper />
            </EventProvider>
          </AuthProvider>
        </BrowserRouter>
      </TTSProvider>
    </QueryClientProvider>
  )
}

export default App
