import type { TokenUsageInfo } from '@opencode-manager/shared/opencode'
import { Card, CardContent } from '@/components/ui/card'
import { formatCompactTokens } from '@/lib/contextUsage'

interface UsageTokenCompositionProps {
  tokens: TokenUsageInfo
}

export function UsageTokenComposition({ tokens }: UsageTokenCompositionProps) {
  const rows = [
    { label: 'Input', value: tokens.input },
    { label: 'Output', value: tokens.output },
    { label: 'Reasoning', value: tokens.reasoning },
    { label: 'Cache read', value: tokens.cache.read },
    { label: 'Cache write', value: tokens.cache.write },
  ]

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Token composition</h2>
        <dl className="space-y-1 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-medium">{formatCompactTokens(row.value)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
