import { memo } from 'react'
import { AlertCircle, KeyRound, XCircle, Clock } from 'lucide-react'
import { parseOpenCodeError, type OpenCodeError } from '@/lib/opencode-errors'

interface MessageErrorProps {
  error: OpenCodeError
}

const getErrorIcon = (errorName: string) => {
  switch (errorName) {
    case 'ProviderAuthError':
      return KeyRound
    case 'MessageAbortedError':
      return XCircle
    case 'MessageOutputLengthError':
      return Clock
    default:
      return AlertCircle
  }
}

export const MessageError = memo(function MessageError({ error }: MessageErrorProps) {
  const parsed = parseOpenCodeError(error)
  if (!parsed) return null

  const Icon = getErrorIcon(error.name)

  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive">
      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{parsed.title}</div>
        <div className="text-xs text-destructive/80 mt-0.5">{parsed.message}</div>
      </div>
    </div>
  )
})
