import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ACTIVITY_WINDOW_MINUTE_OPTIONS, DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import { formatActivityWindow } from '@/lib/activeWork'

export function ActivitySettings() {
  const { preferences, updateSettings } = useSettings()
  const activityWindowMinutes = preferences?.activityWindowMinutes ?? DEFAULT_ACTIVITY_WINDOW_MINUTES

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Activity</h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="activityWindowMinutes">Recent activity window</Label>
          <p className="text-sm text-muted-foreground">
            How far back the Activity panel lists recently active sessions.
          </p>
        </div>
        <Select
          value={String(activityWindowMinutes)}
          onValueChange={(value) => {
            const minutes = ACTIVITY_WINDOW_MINUTE_OPTIONS.find((option) => String(option) === value)
            if (minutes !== undefined) {
              updateSettings({ activityWindowMinutes: minutes })
            }
          }}
        >
          <SelectTrigger id="activityWindowMinutes" className="w-full shrink-0 sm:w-40">
            <SelectValue placeholder="Select a window" />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_WINDOW_MINUTE_OPTIONS.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {formatActivityWindow(minutes)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
