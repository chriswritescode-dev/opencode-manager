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

/**
 * Maps a context-window percentage to a semantic tone: under 50 is `success`, under 80 is `warning`,
 * and 80 or more is `destructive`. An unknown percentage falls back to `success`.
 */
export function contextUsageTone(percentage: number | null): ContextUsageTone {
  if (percentage === null || percentage < 50) return 'success'
  if (percentage < 80) return 'warning'
  return 'destructive'
}

/**
 * Abbreviates a token count so it fits a one-line readout: exact below a thousand, whole thousands up
 * to a million (`41k`), and millions to at most one decimal (`1M`, `1.3M`).
 */
export function formatCompactTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) {
    const thousands = Math.round(tokens / 1000)
    if (thousands < 1000) return `${thousands}k`
  }
  return `${Number((tokens / 1000000).toFixed(1))}M`
}

/**
 * Formats context usage for a compact readout: the percentage of the model's context window when both
 * a limit and a percentage are known, otherwise a compact token count such as `41k`.
 */
export function formatContextUsage(usage: ContextUsage): string {
  if (usage.contextLimit !== null && usage.usagePercentage !== null) {
    return `${usage.usagePercentage}%`
  }
  return formatCompactTokens(usage.totalTokens)
}

/**
 * Builds the screen-reader description of a context-window readout, e.g. `context 42% used` or, when
 * the limit is unknown, `context 12k tokens used`.
 */
export function contextUsageAccessibleLabel(usage: ContextUsage): string {
  if (usage.usagePercentage !== null) {
    return `context ${usage.usagePercentage}% used`
  }
  return `context ${formatCompactTokens(usage.totalTokens)} tokens used`
}
