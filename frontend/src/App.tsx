import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { SessionDetail } from './pages/SessionDetail'
import { TerminalPage } from './pages/Terminal'
import { TasksPage } from './pages/Tasks'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { useSettingsDialog } from './hooks/useSettingsDialog'
import { useTheme } from './hooks/useTheme'
import { TTSProvider } from './contexts/TTSContext'
import { STTProvider } from './contexts/STTContext'
import { TalkModeProvider } from './contexts/TalkModeContext'
import { PermissionProvider } from '@/contexts/PermissionContext'
import { QuestionProvider } from '@/contexts/QuestionContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { QuestionDialog } from './components/question/QuestionDialog'
import { usePermissionContext } from './contexts/PermissionContext'
import { GlobalPermissionNotification } from './components/permissions/GlobalPermissionNotification'
import { NotificationProvider } from './components/providers/NotificationProvider'
import { SessionSwitcher } from './components/session/SessionSwitcher'

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
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/repos/:id" element={<RepoDetail />} />
        <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        <Route path="/repos/:id/terminal" element={<TerminalPage />} />
      </Routes>
      <GlobalPermissionNotification />
      <SessionSwitcher />
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

function App() {

  return (
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <STTProvider>
          <TalkModeProvider>
            <PermissionProvider>
              <QuestionProvider>
                <NotificationProvider>
                  <AppContent />
                  <PermissionDialogWrapper />
                  <QuestionDialog />
                </NotificationProvider>
              </QuestionProvider>
            </PermissionProvider>
          </TalkModeProvider>
        </STTProvider>
      </TTSProvider>
    </QueryClientProvider>
  )
}

export default App
