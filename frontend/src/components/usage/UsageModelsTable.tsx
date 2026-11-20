import type { SessionStatsModelUsage } from '@opencode-manager/shared/opencode'
import { formatCompactTokens } from '@/lib/contextUsage'
import { formatUsd, modelUsageKey, sumModelUsage, totalTokens } from '@/lib/usageStats'

interface UsageModelsTableProps {
  models: SessionStatsModelUsage[]
}

export function UsageModelsTable({ models }: UsageModelsTableProps) {
  const totalCost = sumModelUsage(models).cost

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">Models</h2>
      {models.length === 0 ? (
        <p className="text-sm text-muted-foreground">No model usage in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-left font-medium">Model</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Steps</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Tokens</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Cost</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {models.map((model) => {
                const share = totalCost === 0 ? '—' : `${((model.cost / totalCost) * 100).toFixed(1)}%`
                return (
                  <tr key={modelUsageKey(model.model)}>
                    <td className="px-3 py-2.5">{modelUsageKey(model.model)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{String(model.steps)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCompactTokens(totalTokens(model.tokens))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatUsd(model.cost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{share}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
