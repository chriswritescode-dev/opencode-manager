import type { SessionStatsTools, SessionStatsToolUsage } from '@opencode-manager/shared/opencode'

type ToolTotals = Extract<SessionStatsTools, { mode: 'detail' }>['totals']

interface UsageToolsTableProps {
  totals: ToolTotals
  usage: SessionStatsToolUsage[]
}

export function UsageToolsTable({ totals, usage }: UsageToolsTableProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">Tools</h2>
      {usage.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tool calls in this range.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Tool</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Calls</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Succeeded</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Failed</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Unfinished</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">P50</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {usage.map((entry) => (
              <tr key={entry.name}>
                <td className="px-3 py-2.5">{entry.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{String(entry.calls)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{String(entry.succeeded)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{String(entry.failed)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{String(entry.unfinished)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {entry.durationP50 !== undefined ? `${Math.round(entry.durationP50)} ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border/60">
            <tr>
              <td className="px-3 py-2.5 font-medium">Total</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{String(totals.calls)}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{String(totals.succeeded)}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{String(totals.failed)}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{String(totals.unfinished)}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">—</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}
