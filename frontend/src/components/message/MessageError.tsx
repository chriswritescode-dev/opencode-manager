import { memo } from 'react'
import type { SessionStructuredError } from '@opencode-manager/shared/opencode'
import { AlertCircle, KeyRound, XCircle, Clock } from 'lucide-react'

interface MessageErrorProps {
  error: SessionStructuredError
}

const ERROR_LABELS: Record<string, string> = {
  'provider.auth': 'Provider authentication failed',
  'provider.rate-limit': 'Provider rate limit reached',
  'provider.quota': 'Provider quota exceeded',
  'provider.timeout': 'Provider request timed out',
  'permission.rejected': 'Permission denied',
  'tool.execution': 'Tool execution failed',
  aborted: 'Message aborted',
}

function getErrorIcon(errorType: string) {
  switch (errorType) {
    case 'provider.auth':
      return KeyRound
    case 'permission.rejected':
    case 'aborted':
      return XCircle
    case 'provider.timeout':
      return Clock
    default:
      return AlertCircle
  }
}

export const MessageError = memo(function MessageError({ error }: MessageErrorProps) {
  const Icon = getErrorIcon(error.type)
  const label = ERROR_LABELS[error.type] ?? 'Error'

  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive">
      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-destructive/80 mt-0.5">{error.message}</div>
      </div>
    </div>
  )
})
