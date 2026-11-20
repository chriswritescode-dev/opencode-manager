import type { TokenUsageInfo } from '@opencode-manager/shared/opencode'
import { Card, CardContent } from '@/components/ui/card'
import { formatCompactTokens } from '@/lib/contextUsage'
import { formatUsd, totalTokens } from '@/lib/usageStats'

interface UsageSummaryCardsProps {
  cost: number
  tokens: TokenUsageInfo
  steps: number
  prompts?: number
  activeDays?: number
  streak?: number
}

interface UsageStat {
  label: string
  value: string
}

export function UsageSummaryCards({
  cost,
  tokens,
  steps,
  prompts,
  activeDays,
  streak,
}: UsageSummaryCardsProps) {
  const stats: UsageStat[] = [
    { label: 'Spend', value: formatUsd(cost) },
    { label: 'Tokens', value: formatCompactTokens(totalTokens(tokens)) },
    { label: 'Steps', value: String(steps) },
  ]

  if (prompts !== undefined) stats.push({ label: 'Prompts', value: String(prompts) })
  if (activeDays !== undefined) stats.push({ label: 'Active days', value: String(activeDays) })
  if (streak !== undefined) stats.push({ label: 'Streak', value: String(streak) })

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-lg font-semibold">{stat.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
