import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { SessionDetail } from './pages/SessionDetail'
import { TerminalPage } from './pages/Terminal'
import { Login } from './pages/Login'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { useSettingsDialog } from './hooks/useSettingsDialog'
import { useTheme } from './hooks/useTheme'
import { TTSProvider } from './contexts/TTSContext'
import { STTProvider } from './contexts/STTContext'
import { TalkModeProvider } from './contexts/TalkModeContext'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './hooks/useAuth'
import { PermissionProvider } from '@/contexts/PermissionContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { usePermissionContext } from './contexts/PermissionContext'
import { GlobalPermissionNotification } from './components/permissions/GlobalPermissionNotification'
import { Loader2 } from 'lucide-react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 10,
      refetchOnWindowFocus: true,
    },
  },
})

function AppContent() {
  const { isOpen, close } = useSettingsDialog()
  useTheme()

return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Repos />} />
        <Route path="/repos/:id" element={<RepoDetail />} />
        <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        <Route path="/repos/:id/terminal" element={<TerminalPage />} />
      </Routes>
      <GlobalPermissionNotification />
      <SettingsDialog open={isOpen} onOpenChange={close} />
      <Toaster
        position="bottom-right"
        expand={false}
        richColors
        closeButton
      />
    </BrowserRouter>
  )
}

function PermissionDialogWrapper() {
  const {
    currentPermission,
    pendingCount,
    isFromDifferentSession,
    respondToPermission,
    showDialog,
    setShowDialog,
    currentRepoDirectory,
  } = usePermissionContext()

  return (
    <PermissionRequestDialog
      permission={currentPermission}
      pendingCount={pendingCount}
      isFromDifferentSession={isFromDifferentSession}
      onRespond={respondToPermission}
      open={showDialog}
      onOpenChange={setShowDialog}
      repoDirectory={currentRepoDirectory}
    />
  )
}

function AuthenticatedApp() {
  return (
    <TTSProvider>
      <STTProvider>
        <TalkModeProvider>
          <PermissionProvider>
            <AppContent />
            <PermissionDialogWrapper />
          </PermissionProvider>
        </TalkModeProvider>
      </STTProvider>
    </TTSProvider>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#0d0d0d] to-[#0a0a0a] flex items-center justify-center">
      <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
    </div>
  )
}

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!isAuthenticated) {
    return <Login />
  }

  return <AuthenticatedApp />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
