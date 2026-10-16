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
  aborted: 'Stopped',
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
  const isAborted = error.type === 'aborted'
  const tone = isAborted
    ? 'text-muted-foreground'
    : 'rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive'

  return (
    <div role={isAborted ? 'status' : 'alert'} title={error.message} className={`my-1 flex min-w-0 items-start gap-1.5 text-xs ${tone}`}>
      <Icon className="mt-px h-3.5 w-3.5 flex-shrink-0" />
      <span className="flex-shrink-0 font-medium">{label}</span>
      {error.message && (
        <>
          <span aria-hidden="true" className="opacity-60">·</span>
          <span className={`min-w-0 opacity-80 ${isAborted ? 'truncate' : 'break-words'}`}>{error.message}</span>
        </>
      )}
    </div>
  )
})
