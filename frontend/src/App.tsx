import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { SessionDetail } from './pages/SessionDetail'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { FloatingActionButton } from './components/ui/floating-action-button'
import { useSettingsDialog } from './hooks/useSettingsDialog'
import { useTheme } from './hooks/useTheme'
import { useTTS } from './hooks/useTTS'
import { TTSProvider } from './contexts/TTSContext'

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
  const { isPlaying, stop } = useTTS()
  useTheme()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Repos />} />
        <Route path="/repos/:id" element={<RepoDetail />} />
        <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
        
      </Routes>
      <SettingsDialog open={isOpen} onOpenChange={close} />
      <FloatingActionButton
        variant="stop-audio"
        visible={isPlaying}
        onClick={stop}
        position="top-left"
      />
      <Toaster 
        position="bottom-right"
        expand={false}
        richColors
        closeButton
      />
    </BrowserRouter>
  )
}

function App() {

  return (
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <AppContent />
      </TTSProvider>
    </QueryClientProvider>
  )
}

export default App
