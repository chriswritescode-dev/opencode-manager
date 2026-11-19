import { useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { AlertTriangle, RefreshCw, LogIn, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NotFoundState } from '@/components/ui/not-found-state'
import { parseNetworkError } from '@/lib/opencode-errors'

function getErrorDetails(cause: unknown) {
  if (isRouteErrorResponse(cause)) {
    if (cause.status === 401 || cause.status === 403) {
      return {
        title: 'Authentication Required',
        message: 'Please log in to access this page.',
        isRetryable: false,
        statusCode: cause.status,
      }
    }
    if (cause.status === 404) {
      return {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.',
        isRetryable: false,
        statusCode: cause.status,
      }
    }
    return {
      title: cause.statusText || 'Error',
      message: cause.data?.message || cause.status.toString(),
      isRetryable: true,
      statusCode: cause.status,
    }
  }

  if (cause instanceof Error) {
    const networkParsed = parseNetworkError(cause)
    if (networkParsed.title === 'Connection Failed') {
      return {
        ...networkParsed,
        title: "You're offline",
        message: '',
        isRetryable: false,
        variant: 'offline' as const,
      }
    }
    return networkParsed
  }

  return {
    title: 'Unexpected Error',
    message: 'An unexpected error occurred. Please try refreshing the page.',
    isRetryable: true,
  }
}

export function RouteErrorBoundary() {
  const error = useRouteError()
  const details = getErrorDetails(error)
  const { title, message, isRetryable, statusCode } = details

  const isAuthError = statusCode === 401 || statusCode === 403

  if (statusCode === 404) {
    return <NotFoundState title={title} message={message} backTo="/" backLabel="Go home" />
  }

  if ('variant' in details && details.variant === 'offline') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <img src="/icons/icon-192x192.png" alt="" className="h-36 w-36" />
        <div className="flex items-center gap-3 text-2xl font-semibold text-foreground">
          <WifiOff className="h-6 w-6" />
          <span>{title}</span>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Reload
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-6 text-center bg-background">
      <AlertTriangle className="w-12 h-12 text-destructive" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
      </div>
      <div className="flex gap-3">
        {isAuthError && (
          <Button variant="default" onClick={() => (window.location.href = '/login')}>
            <LogIn className="w-4 h-4 mr-2" />
            Log in
          </Button>
        )}
        {isRetryable && (
          <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}
