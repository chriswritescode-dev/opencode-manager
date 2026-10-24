import { useSessionCost } from '@/hooks/useSessionCost'

interface SessionCostIndicatorProps {
  sessionID: string | undefined
  revertMessageID?: string
}

const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function SessionCostIndicator({ sessionID, revertMessageID }: SessionCostIndicatorProps) {
  const { totalCost, totalTokens, messageCount, isLoading } = useSessionCost(sessionID, revertMessageID)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (messageCount === 0) {
    return null
  }

  const hasCost = totalCost > 0
  const exactTokens = totalTokens.toLocaleString()
  const tokens = compactTokenFormatter.format(totalTokens)
  const summary = hasCost ? `$${totalCost.toFixed(4)} • ${tokens} tokens` : `${tokens} tokens`
  const tooltip = hasCost
    ? `${messageCount} assistant messages • ${exactTokens} tokens • $${totalCost.toFixed(6)}`
    : `${messageCount} assistant messages • ${exactTokens} tokens • free`

  return (
    <div className="flex items-center gap-2">
      <span
        data-testid="session-cost-indicator"
        title={tooltip}
        className="text-xs font-medium whitespace-nowrap text-muted-foreground"
      >
        {summary}
      </span>
    </div>
  )
}
