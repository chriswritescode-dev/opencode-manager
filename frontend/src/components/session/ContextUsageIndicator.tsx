import { useContextUsage } from '@/hooks/useContextUsage'

interface ContextUsageIndicatorProps {
  opcodeUrl: string | null
  sessionID: string | undefined
  directory?: string
  isConnected: boolean
  isReconnecting?: boolean
}

const getUsageTextColor = (percentage: number) => {
  if (percentage < 50) return 'text-green-700 dark:text-green-400'
  if (percentage < 80) return 'text-yellow-700 dark:text-yellow-400'
  return 'text-red-700 dark:text-red-400'
}

export function ContextUsageIndicator({ opcodeUrl, sessionID, directory, isConnected, isReconnecting }: ContextUsageIndicatorProps) {
  const { totalTokens, contextLimit, usagePercentage, isLoading } = useContextUsage(opcodeUrl, sessionID, directory)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (isReconnecting) {
    return <span className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">Reconnecting...</span>
  }

  if (!isConnected) {
    return <span className="text-xs text-muted-foreground font-medium">Disconnected</span>
  }

  const tokenText = contextLimit
    ? `${totalTokens.toLocaleString()} / ${contextLimit.toLocaleString()}`
    : totalTokens.toLocaleString()

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium whitespace-nowrap ${getUsageTextColor(usagePercentage || 0)}`}>
        {tokenText}
      </span>
    </div>
  )
}