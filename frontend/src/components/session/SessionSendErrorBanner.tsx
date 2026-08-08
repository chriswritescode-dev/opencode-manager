import { ErrorBanner } from '@/components/ui/error-banner'
import { useSendErrorStore } from '@/stores/sendErrorStore'

interface SessionSendErrorBannerProps {
  sessionId: string | undefined
  isConnected: boolean
  isReconnecting: boolean
}

export function SessionSendErrorBanner({ sessionId, isConnected, isReconnecting }: SessionSendErrorBannerProps) {
  const sendError = useSendErrorStore((s) => sessionId ? s.errors[sessionId] : null)
  const clearSendError = useSendErrorStore((s) => s.clearError)

  if (!sendError || !sessionId) return null

  if (sendError.kind === 'network' && (!isConnected || isReconnecting)) return null

  return (
    <ErrorBanner
      title={sendError.title}
      summary={sendError.message}
      detail={sendError.detail}
      onDismiss={() => clearSendError(sessionId)}
      className="mb-2"
    />
  )
}
