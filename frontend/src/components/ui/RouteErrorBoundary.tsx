import { useRouteError, useNavigate, isRouteErrorResponse } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AppLoadingSkeleton } from '@/components/ui/AppLoadingSkeleton'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === 'Failed to fetch') return true
  if (error instanceof TypeError && error.message.includes('NetworkError')) return true
  if (error instanceof TypeError && error.message.includes('network')) return true
  return false
}

export function RouteErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()
  const [reconnecting, setReconnecting] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (online && isNetworkError(error)) {
      setReconnecting(true)
      const timer = setTimeout(() => {
        navigate(0)
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [online, error, navigate])

  if (isNetworkError(error)) {
    if (reconnecting) return <AppLoadingSkeleton />

    return (
      <div className="flex h-dvh w-full min-w-0 bg-background">
        <AppLoadingSkeleton />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
          <WifiOff className="w-10 h-10 text-muted-foreground" />
          <div className="text-center space-y-1">
            <p className="font-semibold text-foreground">No connection</p>
            <p className="text-sm text-muted-foreground">Waiting to reconnect…</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate(0)} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry now
          </Button>
        </div>
      </div>
    )
  }

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred'

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-6 text-center bg-background">
      <AlertTriangle className="w-12 h-12 text-destructive" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
      </div>
      <Button variant="outline" onClick={() => navigate(0)} className="gap-2">
        <RefreshCw className="w-4 h-4" />
        Try again
      </Button>
    </div>
  )
}
