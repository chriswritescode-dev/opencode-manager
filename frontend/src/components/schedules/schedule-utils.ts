import cronstrue from 'cronstrue'
import { formatDistanceToNow } from 'date-fns'
import type { CreateScheduleJobRequest, ScheduleJob, ScheduleRun, UpdateScheduleJobRequest } from '@opencode-manager/shared/types'

export const intervalOptions = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
  { label: '1d', value: 1440 },
]

export const cronPresetOptions = [
  { label: 'Weekdays 9 AM', value: '0 9 * * 1-5' },
  { label: 'Daily 9 AM', value: '0 9 * * *' },
  { label: 'Twice daily', value: '0 9,17 * * *' },
  { label: 'Mondays 8 AM', value: '0 8 * * 1' },
]

export const schedulePresetOptions = [
  { label: 'Interval', value: 'interval' },
  { label: 'Hourly', value: 'hourly' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Advanced', value: 'advanced' },
] as const

export const weekdayOptions = [
  { label: 'Mon', value: '1' },
  { label: 'Tue', value: '2' },
  { label: 'Wed', value: '3' },
  { label: 'Thu', value: '4' },
  { label: 'Fri', value: '5' },
  { label: 'Sat', value: '6' },
  { label: 'Sun', value: '0' },
] as const

export type SchedulePreset = typeof schedulePresetOptions[number]['value']

export function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function isNumericToken(value: string): boolean {
  return /^\d+$/.test(value)
}

function parseTimeValue(value: string): { hour: number; minute: number } {
  const [hourValue = '9', minuteValue = '0'] = value.split(':')
  const hour = Number.parseInt(hourValue, 10)
  const minute = Number.parseInt(minuteValue, 10)

  return {
    hour: Number.isNaN(hour) ? 9 : Math.min(Math.max(hour, 0), 23),
    minute: Number.isNaN(minute) ? 0 : Math.min(Math.max(minute, 0), 59),
  }
}

function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function expandDayOfWeekExpression(expression: string): string[] | null {
  const days = new Set<string>()

  for (const token of expression.split(',')) {
    const trimmedToken = token.trim()

    if (!trimmedToken) {
      continue
    }

    if (isNumericToken(trimmedToken)) {
      const normalized = trimmedToken === '7' ? '0' : trimmedToken
      if (!weekdayOptions.some((option) => option.value === normalized)) {
        return null
      }
      days.add(normalized)
      continue
    }

    const rangeMatch = trimmedToken.match(/^(\d)-(\d)$/)
    if (rangeMatch) {
      const start = rangeMatch[1] === '7' ? 0 : Number.parseInt(rangeMatch[1], 10)
      const end = rangeMatch[2] === '7' ? 0 : Number.parseInt(rangeMatch[2], 10)

      if (start > end) {
        return null
      }

      for (let value = start; value <= end; value += 1) {
        days.add(String(value))
      }
      continue
    }

    return null
  }

  return weekdayOptions.filter((option) => days.has(option.value)).map((option) => option.value)
}

function sortWeekdayValues(values: string[]): string[] {
  const order = new Map<string, number>(weekdayOptions.map((option, index) => [option.value, index]))
  return [...new Set(values)].sort((left, right) => (order.get(left) ?? 99) - (order.get(right) ?? 99))
}

export function detectSchedulePreset(job?: ScheduleJob): {
  preset: SchedulePreset
  intervalMinutes: string
  timeOfDay: string
  hourlyMinute: string
  weeklyDays: string[]
  monthlyDay: string
  cronExpression: string
  timezone: string
} {
  const defaultTimezone = job?.timezone ?? getLocalTimeZone()
  const defaults = {
    preset: 'interval' as SchedulePreset,
    intervalMinutes: String(job?.intervalMinutes ?? 60),
    timeOfDay: '09:00',
    hourlyMinute: '0',
    weeklyDays: ['1'],
    monthlyDay: '1',
    cronExpression: job?.cronExpression ?? '0 9 * * 1-5',
    timezone: defaultTimezone,
  }

  if (!job || job.scheduleMode === 'interval') {
    return defaults
  }

  const expression = job.cronExpression?.trim() ?? ''
  const fields = expression.split(/\s+/)
  if (fields.length !== 5) {
    return { ...defaults, preset: 'advanced', cronExpression: expression || defaults.cronExpression }
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (!isNumericToken(minute)) {
    return { ...defaults, preset: 'advanced', cronExpression: expression }
  }

  if (month === '*' && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return {
      ...defaults,
      preset: 'hourly',
      hourlyMinute: minute,
      cronExpression: expression,
    }
  }

  if (!isNumericToken(hour)) {
    return { ...defaults, preset: 'advanced', cronExpression: expression }
  }

  const timeOfDay = toTimeValue(Number.parseInt(hour, 10), Number.parseInt(minute, 10))

  if (month === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return { ...defaults, preset: 'daily', timeOfDay, cronExpression: expression }
  }

  if (month === '*' && dayOfMonth === '*' && dayOfWeek === '1-5') {
    return { ...defaults, preset: 'weekdays', timeOfDay, cronExpression: expression, weeklyDays: ['1', '2', '3', '4', '5'] }
  }

  if (month === '*' && dayOfMonth === '*') {
    const weeklyDays = expandDayOfWeekExpression(dayOfWeek)
    if (weeklyDays && weeklyDays.length > 0) {
      return { ...defaults, preset: 'weekly', timeOfDay, weeklyDays, cronExpression: expression }
    }
  }

  if (month === '*' && dayOfWeek === '*' && isNumericToken(dayOfMonth)) {
    return {
      ...defaults,
      preset: 'monthly',
      timeOfDay,
      monthlyDay: dayOfMonth,
      cronExpression: expression,
    }
  }

  return { ...defaults, preset: 'advanced', timeOfDay, cronExpression: expression }
}

export function buildCronExpressionFromPreset(input: {
  preset: SchedulePreset
  intervalMinutes?: string
  timeOfDay: string
  hourlyMinute: string
  weeklyDays: string[]
  monthlyDay: string
  cronExpression: string
}): string {
  const { hour, minute } = parseTimeValue(input.timeOfDay)

  switch (input.preset) {
    case 'hourly':
      return `${Math.min(Math.max(Number.parseInt(input.hourlyMinute, 10) || 0, 0), 59)} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`
    case 'weekly':
      return `${minute} ${hour} * * ${sortWeekdayValues(input.weeklyDays).join(',') || '1'}`
    case 'monthly':
      return `${minute} ${hour} ${Math.min(Math.max(Number.parseInt(input.monthlyDay, 10) || 1, 1), 31)} * *`
    case 'advanced':
      return input.cronExpression.trim()
    default:
      return input.cronExpression.trim()
  }
}

export function formatIntervalLabel(intervalMinutes: number | null): string {
  if (!intervalMinutes) {
    return 'Custom interval'
  }

  if (intervalMinutes % 1440 === 0) {
    const days = intervalMinutes / 1440
    return `Every ${days} day${days === 1 ? '' : 's'}`
  }

  if (intervalMinutes % 60 === 0) {
    const hours = intervalMinutes / 60
    return `Every ${hours} hour${hours === 1 ? '' : 's'}`
  }

  return `Every ${intervalMinutes} minute${intervalMinutes === 1 ? '' : 's'}`
}

export function formatCronHumanText(cronExpression: string | null): string | null {
  if (!cronExpression) {
    return null
  }

  try {
    return cronstrue.toString(cronExpression, {
      throwExceptionOnParseError: true,
      use24HourTimeFormat: false,
    })
  } catch {
    return null
  }
}

export function formatScheduleSummary(job: ScheduleJob): string {
  if (job.scheduleMode === 'cron') {
    return `${formatCronHumanText(job.cronExpression) ?? (job.cronExpression ?? 'Custom cron')}${job.timezone ? ` - ${job.timezone}` : ''}`
  }

  return formatIntervalLabel(job.intervalMinutes)
}

export function formatScheduleShortLabel(job: ScheduleJob): string {
  if (job.scheduleMode === 'cron') {
    return 'Cron schedule'
  }

  return formatIntervalLabel(job.intervalMinutes)
}

export function formatDraftScheduleSummary(input: {
  preset: SchedulePreset
  intervalMinutes: string
  timeOfDay: string
  hourlyMinute: string
  weeklyDays: string[]
  monthlyDay: string
  cronExpression: string
  timezone: string
}): string {
  if (input.preset === 'interval') {
    const parsedInterval = Number.parseInt(input.intervalMinutes, 10)
    return formatIntervalLabel(Number.isNaN(parsedInterval) ? null : parsedInterval)
  }

  const builtCronExpression = buildCronExpressionFromPreset(input)
  const humanText = formatCronHumanText(builtCronExpression)

  return builtCronExpression
    ? `${humanText ?? builtCronExpression} - ${input.timezone.trim() || 'UTC'}`
    : 'Choose a schedule'
}

export function toUpdateScheduleRequest(data: CreateScheduleJobRequest): UpdateScheduleJobRequest {
  if (data.scheduleMode === 'cron') {
    return {
      ...data,
      description: data.description ?? null,
      agentSlug: data.agentSlug ?? null,
      model: data.model ?? null,
      intervalMinutes: null,
    }
  }

  return {
    ...data,
    description: data.description ?? null,
    agentSlug: data.agentSlug ?? null,
    model: data.model ?? null,
    cronExpression: null,
    timezone: null,
  }
}

export function formatTimestamp(value: number | null): string {
  if (!value) {
    return 'Never'
  }

  return `${new Date(value).toLocaleString()} (${formatDistanceToNow(value, { addSuffix: true })})`
}

export function getRunTone(run: ScheduleRun): string {
  if (run.status === 'completed') {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  }

  if (run.status === 'failed') {
    return 'bg-red-500/15 text-red-300 border-red-500/30'
  }

  if (run.status === 'cancelled') {
    return 'bg-slate-500/15 text-slate-300 border-slate-500/30'
  }

  return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
}

export function getJobStatusTone(job: ScheduleJob): string {
  return job.enabled
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    : 'bg-muted text-muted-foreground border-border'
}

export function hasSkillMetadata(job?: ScheduleJob | null): boolean {
  if (!job?.skillMetadata) {
    return false
  }

  return job.skillMetadata.skillSlugs.length > 0 || Boolean(job.skillMetadata.notes?.trim())
}
