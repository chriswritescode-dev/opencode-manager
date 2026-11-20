import { useEffect } from 'react'
import { format } from 'date-fns'
import type { SessionStatsInfo } from '@opencode-manager/shared/opencode'
import { ActivitySpinner } from '@/components/ui/activity-spinner'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-banner'
import { useUsageStats } from '@/hooks/useUsage'
import {
  USAGE_RANGE_STORAGE_KEY,
  useUsageModelsPreference,
  useUsageRangePreference,
} from '@/hooks/useUsagePreferences'
import {
  DEFAULT_GLOBAL_USAGE_RANGE,
  rangeHasDailyActivity,
  resolveUsageRange,
  type ResolvedUsageRange,
  type UsageRangeSelection,
} from '@/lib/usageRange'
import { filterModelUsage, modelUsageKey } from '@/lib/usageStats'
import { UsageActivityChart } from './UsageActivityChart'
import { UsageModelFilter } from './UsageModelFilter'
import { UsageModelsTable } from './UsageModelsTable'
import { UsageRangePicker } from './UsageRangePicker'
import { UsageSessionsTable } from './UsageSessionsTable'
import { UsageSummaryCards } from './UsageSummaryCards'
import { UsageTokenComposition } from './UsageTokenComposition'
import { UsageToolsTable } from './UsageToolsTable'

interface UsageDashboardProps {
  serverId: string
}

const RANGE_DISPLAY_FORMAT = 'MMM d, yyyy HH:mm'

function isDefaultUsageRange(selection: UsageRangeSelection): boolean {
  if (selection.preset !== DEFAULT_GLOBAL_USAGE_RANGE.preset) return false
  if (selection.preset !== 'custom') return true
  const fallback = DEFAULT_GLOBAL_USAGE_RANGE
  return (
    fallback.preset === 'custom' &&
    selection.from === fallback.from &&
    selection.to === fallback.to
  )
}

export function UsageDashboard({ serverId }: UsageDashboardProps) {
  const [range, setSelection] = useUsageRangePreference(
    USAGE_RANGE_STORAGE_KEY,
    DEFAULT_GLOBAL_USAGE_RANGE,
  )
  const [models, setModels] = useUsageModelsPreference()
  const resolvedRange = resolveUsageRange(range, Date.now())
  const stats = useUsageStats(range, serverId)
  const data = stats.data

  useEffect(() => {
    if (!data) return
    const available = new Set(data.models.map((entry) => modelUsageKey(entry.model)))
    const pruned = models.filter((key) => available.has(key))
    if (pruned.length !== models.length) setModels(pruned)
  }, [data, models, setModels])

  const isFiltered = models.length > 0
  const showReset = isFiltered || !isDefaultUsageRange(range)

  function renderStats(statsData: SessionStatsInfo, activeRange: ResolvedUsageRange) {
    const totals = filterModelUsage(statsData.models, models)
    return (
      <div className="space-y-6">
        <p className="text-xs text-muted-foreground">
          {`${format(statsData.range.from, RANGE_DISPLAY_FORMAT)} – ${format(statsData.range.to, RANGE_DISPLAY_FORMAT)}`}
        </p>
        {isFiltered ? (
          <>
            <UsageSummaryCards cost={totals.cost} tokens={totals.tokens} steps={totals.steps} />
            <UsageTokenComposition tokens={totals.tokens} />
            <UsageModelsTable
              models={statsData.models.filter((entry) =>
                models.includes(modelUsageKey(entry.model)),
              )}
            />
            <p className="text-xs text-muted-foreground">
              Prompts, streak, activity, tool reliability and sessions cannot be split per model,
              so they are hidden while a model filter is active.
            </p>
          </>
        ) : (
          <>
            <UsageSummaryCards
              cost={totals.cost}
              tokens={totals.tokens}
              steps={totals.steps}
              prompts={statsData.prompts}
              activeDays={statsData.activeDays}
              streak={statsData.streak}
            />
            <UsageTokenComposition tokens={totals.tokens} />
            {rangeHasDailyActivity(range, Date.now()) && (
              <UsageActivityChart activity={statsData.activity} />
            )}
            <UsageModelsTable models={statsData.models} />
            {statsData.tools.mode === 'detail' && (
              <UsageToolsTable totals={statsData.tools.totals} usage={statsData.tools.usage} />
            )}
            <UsageSessionsTable serverId={serverId} range={activeRange} />
          </>
        )}
      </div>
    )
  }

  function renderContent() {
    if (resolvedRange === null) {
      return <p>Choose a start and end time to see usage for a custom range.</p>
    }
    if (stats.isPending) {
      return (
        <div className="flex items-center gap-2">
          <ActivitySpinner />
          <span>Loading usage…</span>
        </div>
      )
    }
    if (stats.isError) {
      return (
        <ErrorBanner
          title="Usage unavailable"
          summary="This OpenCode server could not return usage statistics."
          detail={stats.error instanceof Error ? stats.error.message : undefined}
        />
      )
    }
    if (!stats.data) return null
    return renderStats(stats.data, resolvedRange)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <UsageRangePicker value={range} onChange={setSelection} />
        <UsageModelFilter
          models={data?.models.map((entry) => modelUsageKey(entry.model)) ?? []}
          selected={models}
          onChange={setModels}
        />
        {showReset && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setModels([])
              setSelection(DEFAULT_GLOBAL_USAGE_RANGE)
            }}
          >
            Reset filters
          </Button>
        )}
      </div>
      {renderContent()}
    </div>
  )
}
