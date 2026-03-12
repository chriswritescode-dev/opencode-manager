import { CronExpressionParser } from 'cron-parser'
import type {
  CreateScheduleJobRequest,
  ScheduleJob,
  ScheduleMode,
  ScheduleSkillMetadata,
  UpdateScheduleJobRequest,
} from '@opencode-manager/shared/types'

const DEFAULT_CRON_TIMEZONE = 'UTC'

export interface ScheduleJobPersistenceInput {
  name: string
  description: string | null
  enabled: boolean
  scheduleMode: ScheduleMode
  intervalMinutes: number | null
  cronExpression: string | null
  timezone: string | null
  agentSlug: string | null
  prompt: string
  model: string | null
  skillMetadata: ScheduleSkillMetadata | null | undefined
  nextRunAt: number | null
}

function validateTimeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`)
  }
}

function getCronNextRunAt(cronExpression: string, timezone: string, currentDate: number): number {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: new Date(currentDate),
    tz: timezone,
  })

  return interval.next().getTime()
}

function normalizeCronConfig(cronExpression: string, timezone: string | null | undefined, currentDate: number) {
  const normalizedTimezone = validateTimeZone(timezone?.trim() || DEFAULT_CRON_TIMEZONE)
  const normalizedCronExpression = cronExpression.trim()
  const nextRunAt = getCronNextRunAt(normalizedCronExpression, normalizedTimezone, currentDate)

  return {
    scheduleMode: 'cron' as const,
    intervalMinutes: null,
    cronExpression: normalizedCronExpression,
    timezone: normalizedTimezone,
    nextRunAt,
  }
}

function normalizeIntervalConfig(intervalMinutes: number, currentDate: number) {
  return {
    scheduleMode: 'interval' as const,
    intervalMinutes,
    cronExpression: null,
    timezone: null,
    nextRunAt: currentDate + intervalMinutes * 60_000,
  }
}

export function computeNextRunAtForJob(job: ScheduleJob, currentDate: number): number | null {
  if (!job.enabled) {
    return null
  }

  if (job.scheduleMode === 'cron') {
    if (!job.cronExpression) {
      throw new Error('Cron expression is required for cron schedules')
    }

    return getCronNextRunAt(job.cronExpression, job.timezone || DEFAULT_CRON_TIMEZONE, currentDate)
  }

  if (!job.intervalMinutes) {
    throw new Error('Interval minutes are required for interval schedules')
  }

  return currentDate + job.intervalMinutes * 60_000
}

export function buildCreateSchedulePersistenceInput(input: CreateScheduleJobRequest, currentDate: number = Date.now()): ScheduleJobPersistenceInput {
  const base = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    enabled: input.enabled !== false,
    agentSlug: input.agentSlug?.trim() || null,
    prompt: input.prompt.trim(),
    model: input.model?.trim() || null,
    skillMetadata: input.skillMetadata,
  }

  const scheduleConfig = input.scheduleMode === 'cron'
    ? normalizeCronConfig(input.cronExpression, input.timezone, currentDate)
    : normalizeIntervalConfig(input.intervalMinutes, currentDate)

  return {
    ...base,
    ...scheduleConfig,
    nextRunAt: base.enabled ? scheduleConfig.nextRunAt : null,
  }
}

export function buildUpdatedSchedulePersistenceInput(
  existing: ScheduleJob,
  input: UpdateScheduleJobRequest,
  currentDate: number = Date.now(),
): ScheduleJobPersistenceInput {
  const enabled = input.enabled ?? existing.enabled
  const scheduleMode = input.scheduleMode ?? existing.scheduleMode

  const scheduleConfig = scheduleMode === 'cron'
    ? normalizeCronConfig(
        input.cronExpression ?? existing.cronExpression ?? '',
        input.timezone ?? existing.timezone ?? DEFAULT_CRON_TIMEZONE,
        currentDate,
      )
    : normalizeIntervalConfig(
        input.intervalMinutes ?? existing.intervalMinutes ?? 60,
        currentDate,
      )

  const scheduleChanged =
    input.scheduleMode !== undefined ||
    input.intervalMinutes !== undefined ||
    input.cronExpression !== undefined ||
    input.timezone !== undefined

  const nextRunAt = enabled
    ? scheduleChanged || input.enabled !== undefined || existing.nextRunAt === null
      ? scheduleConfig.nextRunAt
      : existing.nextRunAt
    : null

  return {
    name: input.name?.trim() || existing.name,
    description: input.description === undefined ? existing.description : (input.description?.trim() || null),
    enabled,
    scheduleMode: scheduleConfig.scheduleMode,
    intervalMinutes: scheduleConfig.intervalMinutes,
    cronExpression: scheduleConfig.cronExpression,
    timezone: scheduleConfig.timezone,
    agentSlug: input.agentSlug === undefined ? existing.agentSlug : (input.agentSlug?.trim() || null),
    prompt: input.prompt?.trim() || existing.prompt,
    model: input.model === undefined ? existing.model : (input.model?.trim() || null),
    skillMetadata: input.skillMetadata === undefined ? existing.skillMetadata : input.skillMetadata,
    nextRunAt,
  }
}
