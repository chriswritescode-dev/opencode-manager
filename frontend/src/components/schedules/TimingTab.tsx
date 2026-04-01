import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TabsContent } from '@/components/ui/tabs'
import {
  buildCronExpressionFromPreset,
  cronPresetOptions,
  intervalOptions,
  schedulePresetOptions,
  weekdayOptions,
  type SchedulePreset,
} from '@/components/schedules/schedule-utils'
import { formatDraftScheduleSummary, getLocalTimeZone } from '@/components/schedules/schedule-utils'

type TimingTabProps = {
  schedulePreset: SchedulePreset
  onSchedulePresetChange: (value: SchedulePreset) => void
  intervalMinutes: string
  onIntervalMinutesChange: (value: string) => void
  timeOfDay: string
  onTimeOfDayChange: (value: string) => void
  hourlyMinute: string
  onHourlyMinuteChange: (value: string) => void
  weeklyDays: string[]
  onWeeklyDaysChange: (value: string[]) => void
  monthlyDay: string
  onMonthlyDayChange: (value: string) => void
  cronExpression: string
  onCronExpressionChange: (value: string) => void
  timezone: string
  onTimezoneChange: (value: string) => void
}

export function TimingTab({
  schedulePreset,
  onSchedulePresetChange,
  intervalMinutes,
  onIntervalMinutesChange,
  timeOfDay,
  onTimeOfDayChange,
  hourlyMinute,
  onHourlyMinuteChange,
  weeklyDays,
  onWeeklyDaysChange,
  monthlyDay,
  onMonthlyDayChange,
  cronExpression,
  onCronExpressionChange,
  timezone,
  onTimezoneChange,
}: TimingTabProps) {
  return (
    <TabsContent value="timing" className="px-3 mt-0 min-h-0 flex-1 overflow-y-auto sm:px-6 pt-4 pb-5">
      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <Label>Repeat</Label>
            <p className="mt-1 text-xs text-muted-foreground">Use a simple scheduler builder by default. Advanced cron is still available if you need it.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {schedulePresetOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={schedulePreset === option.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSchedulePresetChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {schedulePreset === 'interval' ? (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="schedule-interval">Run every</Label>
              <Input
                id="schedule-interval"
                type="number"
                min={5}
                max={10080}
                value={intervalMinutes}
                onChange={(event) => onIntervalMinutesChange(event.target.value)}
                className="w-28"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {intervalOptions.map((option) => (
                <Button key={option.value} type="button" variant={intervalMinutes === String(option.value) ? 'default' : 'outline'} size="sm" onClick={() => onIntervalMinutesChange(String(option.value))}>
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        ) : schedulePreset === 'hourly' ? (
          <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="schedule-hourly-minute">Minute</Label>
              <Input
                id="schedule-hourly-minute"
                type="number"
                min={0}
                max={59}
                value={hourlyMinute}
                onChange={(event) => onHourlyMinuteChange(event.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">Run every hour at the selected minute mark.</p>
          </div>
        ) : schedulePreset === 'daily' || schedulePreset === 'weekdays' ? (
          <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-time">Time</Label>
              <Input id="schedule-time" type="time" value={timeOfDay} onChange={(event) => onTimeOfDayChange(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-timezone">Timezone</Label>
              <Input id="schedule-timezone" value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} placeholder={getLocalTimeZone()} />
            </div>
          </div>
        ) : schedulePreset === 'weekly' ? (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="space-y-2">
              <Label>Days</Label>
              <div className="flex flex-wrap gap-2">
                {weekdayOptions.map((option) => {
                  const selected = weeklyDays.includes(option.value)

                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={selected ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => onWeeklyDaysChange(selected ? weeklyDays.filter((value) => value !== option.value) : [...weeklyDays, option.value])}
                    >
                      {option.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-weekly-time">Time</Label>
                <Input id="schedule-weekly-time" type="time" value={timeOfDay} onChange={(event) => onTimeOfDayChange(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-weekly-timezone">Timezone</Label>
                <Input id="schedule-weekly-timezone" value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} placeholder={getLocalTimeZone()} />
              </div>
            </div>
          </div>
        ) : schedulePreset === 'monthly' ? (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="schedule-monthly-day">Day</Label>
                <Input
                  id="schedule-monthly-day"
                  type="number"
                  min={1}
                  max={31}
                  value={monthlyDay}
                  onChange={(event) => onMonthlyDayChange(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-monthly-time">Time</Label>
                <Input id="schedule-monthly-time" type="time" value={timeOfDay} onChange={(event) => onTimeOfDayChange(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-monthly-timezone">Timezone</Label>
                <Input id="schedule-monthly-timezone" value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} placeholder={getLocalTimeZone()} />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="space-y-2">
              <Label htmlFor="schedule-cron">Cron expression</Label>
              <Input
                id="schedule-cron"
                value={cronExpression}
                onChange={(event) => onCronExpressionChange(event.target.value)}
                placeholder="0 9 * * 1-5"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Examples: `0 9 * * 1-5` weekdays at 9 AM, `30 6 1 * *` monthly on the 1st at 6:30 AM.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-timezone">Timezone</Label>
              <Input
                id="schedule-timezone"
                value={timezone}
                onChange={(event) => onTimezoneChange(event.target.value)}
                placeholder={getLocalTimeZone()}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {cronPresetOptions.map((option) => (
                <Button key={option.value} type="button" variant="outline" size="sm" onClick={() => onCronExpressionChange(option.value)}>
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Schedule Preview</p>
          <p className="mt-2 text-sm font-medium break-words">{formatDraftScheduleSummary({ preset: schedulePreset, intervalMinutes, timeOfDay, hourlyMinute, weeklyDays, monthlyDay, cronExpression, timezone })}</p>
          {schedulePreset !== 'interval' && (
            <p className="mt-2 text-xs text-muted-foreground font-mono break-all">
              {buildCronExpressionFromPreset({ preset: schedulePreset, intervalMinutes, timeOfDay, hourlyMinute, weeklyDays, monthlyDay, cronExpression })}
            </p>
          )}
        </div>
      </div>
    </TabsContent>
  )
}
