import type { SessionStatsActivity } from '@opencode-manager/shared/opencode'

interface UsageActivityChartProps {
  activity: SessionStatsActivity[]
}

export function UsageActivityChart({ activity }: UsageActivityChartProps) {
  if (activity.length === 0) return null

  const maxSteps = Math.max(...activity.map((day) => day.steps))

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">Activity</h2>
      <div className="flex h-32 items-end gap-1">
        {activity.map((day) => {
          const height = maxSteps === 0 ? 0 : Math.max(2, Math.round((day.steps / maxSteps) * 100))
          const label = `${day.date}: ${day.steps} steps`
          return (
            <div
              key={day.date}
              role="img"
              aria-label={label}
              title={label}
              className="flex-1 rounded-sm bg-primary"
              style={{ height: `${height}%` }}
            />
          )
        })}
      </div>
    </div>
  )
}
