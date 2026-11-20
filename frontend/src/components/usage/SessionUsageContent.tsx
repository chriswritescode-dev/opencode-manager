import { useEffect, useMemo, useState } from 'react'
import { ActivitySpinner } from '@/components/ui/activity-spinner'
import { ErrorBanner } from '@/components/ui/error-banner'
import { useOpenCodeServerId } from '@/contexts/opencode-server-context'
import { useSessionUsage } from '@/hooks/useUsage'
import { SESSION_USAGE_RANGE_STORAGE_KEY, useUsageRangePreference } from '@/hooks/useUsagePreferences'
import { DEFAULT_SESSION_USAGE_RANGE, resolveUsageRange } from '@/lib/usageRange'
import { summarizeSessionSteps } from '@/lib/usageStats'
import { UsageModelFilter } from './UsageModelFilter'
import { UsageModelsTable } from './UsageModelsTable'
import { UsageRangePicker } from './UsageRangePicker'
import { UsageSummaryCards } from './UsageSummaryCards'
import { UsageTokenComposition } from './UsageTokenComposition'
import { UsageToolsTable } from './UsageToolsTable'

interface SessionUsageContentProps {
  sessionId: string
  compact?: boolean
}

export function SessionUsageContent({ sessionId, compact }: SessionUsageContentProps) {
  const serverId = useOpenCodeServerId()
  const query = useSessionUsage(sessionId, serverId)
  const steps = query.data?.steps
  const [range, setRange] = useUsageRangePreference(
    SESSION_USAGE_RANGE_STORAGE_KEY,
    DEFAULT_SESSION_USAGE_RANGE,
  )
  const [models, setModels] = useState<string[]>([])

  const summary = useMemo(
    () =>
      summarizeSessionSteps(steps ?? [], {
        range: resolveUsageRange(range, Date.now()) ?? {},
        models,
      }),
    [steps, range, models],
  )

  useEffect(() => {
    const available = new Set(summary.availableModels)
    const remaining = models.filter((key) => available.has(key))
    if (remaining.length !== models.length) setModels(remaining)
  }, [models, summary.availableModels])

  const toolTotals = useMemo(
    () =>
      summary.tools.reduce(
        (totals, tool) => ({
          calls: totals.calls + tool.calls,
          succeeded: totals.succeeded + tool.succeeded,
          failed: totals.failed + tool.failed,
          unfinished: totals.unfinished + tool.unfinished,
        }),
        { calls: 0, succeeded: 0, failed: 0, unfinished: 0 },
      ),
    [summary.tools],
  )

  const errorDetail =
    query.error instanceof Error ? query.error.message : 'The session usage request failed.'

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <div className="flex flex-wrap items-end gap-2">
        <UsageRangePicker value={range} onChange={setRange} />
        <UsageModelFilter
          models={summary.availableModels}
          selected={models}
          onChange={setModels}
        />
      </div>

      {query.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ActivitySpinner />
          <span>Loading session usage…</span>
        </div>
      ) : query.isError ? (
        <ErrorBanner
          title="Session usage unavailable"
          summary="This session's steps could not be loaded."
          detail={errorDetail}
        />
      ) : summary.steps === 0 ? (
        <p className="text-sm text-muted-foreground">No assistant steps in this range.</p>
      ) : (
        <>
          <UsageSummaryCards
            cost={summary.cost}
            tokens={summary.tokens}
            steps={summary.steps}
            tokensPerSecond={summary.averageTokensPerSecond}
          />
          <UsageTokenComposition tokens={summary.tokens} />
          <UsageModelsTable models={summary.models} />
          <UsageToolsTable totals={toolTotals} usage={summary.tools} />
        </>
      )}

      {query.data?.truncated === true && (
        <p className="text-xs text-muted-foreground">
          Only the newest 1,000 steps of this session are summarized.
        </p>
      )}
    </div>
  )
}
