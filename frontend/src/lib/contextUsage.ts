export interface ContextUsage {
  totalTokens: number
  usagePercentage: number | null
  contextLimit: number | null
}

export type ContextUsageTone = 'success' | 'warning' | 'destructive'

export const CONTEXT_USAGE_TEXT_CLASS: Record<ContextUsageTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
}

export const CONTEXT_USAGE_BG_CLASS: Record<ContextUsageTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
}

export function contextUsageTone(percentage: number | null): ContextUsageTone {
  if (percentage === null || percentage < 50) return 'success'
  if (percentage < 80) return 'warning'
  return 'destructive'
}

export function formatCompactTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) {
    const thousands = Math.round(tokens / 1000)
    if (thousands < 1000) return `${thousands}k`
  }
  return `${Number((tokens / 1000000).toFixed(1))}M`
}

export function formatContextUsage(usage: ContextUsage): string {
  if (usage.contextLimit !== null && usage.usagePercentage !== null) {
    return `${usage.usagePercentage}%`
  }
  return formatCompactTokens(usage.totalTokens)
}

export function contextUsageAccessibleLabel(usage: ContextUsage): string {
  if (usage.usagePercentage !== null) {
    return `context ${usage.usagePercentage}% used`
  }
  return `context ${formatCompactTokens(usage.totalTokens)} tokens used`
}
