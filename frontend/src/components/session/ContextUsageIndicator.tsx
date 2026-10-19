import { useContextUsage } from '@/hooks/useContextUsage'
import { useMobile } from '@/hooks/useMobile'

interface ContextUsageIndicatorProps {
  directory?: string
  sessionID: string | undefined
  isConnected: boolean
  isReconnecting?: boolean
  revertMessageID?: string
}

const getUsageTextColor = (percentage: number) => {
  if (percentage < 50) return 'text-success'
  if (percentage < 80) return 'text-warning'
  return 'text-destructive'
}

export function ContextUsageIndicator({
  directory,
  sessionID,
  isConnected,
  isReconnecting,
  revertMessageID,
}: ContextUsageIndicatorProps) {
  const { usage, isLoading } = useContextUsage(sessionID, directory, revertMessageID)
  const isMobile = useMobile()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (isReconnecting) {
    return <span className="text-xs text-warning font-medium">Reconnecting...</span>
  }

  if (!isConnected) {
    return <span className="text-xs text-muted-foreground font-medium">Disconnected</span>
  }

  if (!usage) {
    return null
  }

  const compactText = usage.usagePercentage === null
    ? usage.totalTokens.toLocaleString()
    : `${usage.usagePercentage}%`

  const fullText = usage.usagePercentage === null
    ? usage.totalTokens.toLocaleString()
    : `${usage.totalTokens.toLocaleString()} (${usage.usagePercentage}%)`

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium whitespace-nowrap ${getUsageTextColor(usage.usagePercentage ?? 0)}`}>
        {isMobile ? compactText : fullText}
      </span>
    </div>
  )
}
