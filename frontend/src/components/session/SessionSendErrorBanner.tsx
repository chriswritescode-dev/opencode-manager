import { ErrorBanner } from '@/components/ui/error-banner'
import { useSendErrorStore } from '@/stores/sendErrorStore'

interface SessionSendErrorBannerProps {
  sessionId: string | undefined
}

export function SessionSendErrorBanner({ sessionId }: SessionSendErrorBannerProps) {
  const sendError = useSendErrorStore((s) => sessionId ? s.errors[sessionId] : null)
  const clearSendError = useSendErrorStore((s) => s.clearError)

  if (!sendError || !sessionId) return null

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
