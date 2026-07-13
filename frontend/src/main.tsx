import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { registerServiceWorker } from './lib/serviceWorker'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>,
)
