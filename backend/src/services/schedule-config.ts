import { Cron } from 'croner'
import type {
  CreateScheduleJobRequest,
  ScheduleJob,
  ScheduleMcpServer,
  ScheduleMode,
  SchedulePermissionConfig,
  ScheduleSandboxConfig,
  ScheduleSkillMetadata,
  ScheduleWorkspaceMode,
  UpdateScheduleJobRequest,
} from '@opencode-manager/shared/types'

const DEFAULT_CRON_TIMEZONE = 'UTC'

export interface ScheduleJobPersistenceInput {
  name: string
  description: string | null
  enabled: boolean
  showInInbox: boolean
  scheduleMode: ScheduleMode
  intervalMinutes: number | null
  cronExpression: string | null
  runAt: string | null
  timezone: string | null
  agentSlug: string | null
  prompt: string
  model: string | null
  skillMetadata: ScheduleSkillMetadata | null | undefined
  permissionConfig: SchedulePermissionConfig | null
  mcpServers: ScheduleMcpServer[]
  branch: string | null
  workspaceMode: ScheduleWorkspaceMode
  sandbox: ScheduleSandboxConfig | null
  directory?: string | null
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

export function resolveOnceRunAtMs(runAt: string, timezone: string): number {
  const normalizedTimezone = validateTimeZone(timezone)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(runAt)
  if (!match) {
    throw new Error('Invalid date and time: ' + runAt)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const parsed = new Date(guess)

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) {
    throw new Error('Invalid date and time: ' + runAt)
  }

  const offsetAt = (timestamp: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: normalizedTimezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(timestamp))
    const partValue = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value)
    const wallClockMs = Date.UTC(
      partValue('year'),
      partValue('month') - 1,
      partValue('day'),
      partValue('hour'),
      partValue('minute'),
      partValue('second'),
    )
    return wallClockMs - timestamp
  }

  const offBefore = offsetAt(guess - 86_400_000)
  const offAfter = offsetAt(guess + 86_400_000)
  const matches = [guess - offBefore, guess - offAfter].filter(
    (candidate) => candidate + offsetAt(candidate) === guess,
  )
  if (matches.length === 0) {
    return guess - offBefore
  }
  return Math.min(...matches)
}

function getCronNextRunAt(cronExpression: string, timezone: string, currentDate: number): number {
  const cron = new Cron(cronExpression, { timezone })
  const next = cron.nextRun(new Date(currentDate))
  if (!next) {
    throw new Error(`Cron expression "${cronExpression}" has no upcoming run`)
  }
  return next.getTime()
}

function normalizeCronConfig(cronExpression: string, timezone: string | null | undefined, currentDate: number) {
  const normalizedTimezone = validateTimeZone(timezone?.trim() || DEFAULT_CRON_TIMEZONE)
  const normalizedCronExpression = cronExpression.trim()
  const nextRunAt = getCronNextRunAt(normalizedCronExpression, normalizedTimezone, currentDate)

  return {
    scheduleMode: 'cron' as const,
    intervalMinutes: null,
    cronExpression: normalizedCronExpression,
    runAt: null,
    timezone: normalizedTimezone,
    nextRunAt,
  }
}

function normalizeIntervalConfig(intervalMinutes: number, currentDate: number) {
  return {
    scheduleMode: 'interval' as const,
    intervalMinutes,
    cronExpression: null,
    runAt: null,
    timezone: null,
    nextRunAt: currentDate + intervalMinutes * 60_000,
  }
}

function normalizeOnceConfig(runAt: string, timezone: string | null | undefined) {
  const normalizedTimezone = validateTimeZone(timezone?.trim() || DEFAULT_CRON_TIMEZONE)

  return {
    scheduleMode: 'once' as const,
    intervalMinutes: null,
    cronExpression: null,
    runAt,
    timezone: normalizedTimezone,
    nextRunAt: resolveOnceRunAtMs(runAt, normalizedTimezone),
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

  if (job.scheduleMode === 'once') {
    if (!job.runAt) {
      throw new Error('A date and time is required for one-time schedules')
    }

    const runAt = resolveOnceRunAtMs(job.runAt, job.timezone || DEFAULT_CRON_TIMEZONE)
    return runAt > currentDate ? runAt : null
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
    showInInbox: input.showInInbox !== false,
    agentSlug: input.agentSlug?.trim() || null,
    prompt: input.prompt.trim(),
    model: input.model?.trim() || null,
    skillMetadata: input.skillMetadata,
    branch: input.branch?.trim() || null,
    workspaceMode: input.workspaceMode ?? 'worktree',
    sandbox: input.sandbox ?? null,
    ...(input.directory !== undefined ? { directory: input.directory?.trim() || null } : {}),
  }

  const scheduleConfig = input.scheduleMode === 'cron'
    ? normalizeCronConfig(input.cronExpression, input.timezone, currentDate)
    : input.scheduleMode === 'once'
      ? normalizeOnceConfig(input.runAt, input.timezone)
      : normalizeIntervalConfig(input.intervalMinutes, currentDate)

  if (input.scheduleMode === 'once' && base.enabled && scheduleConfig.nextRunAt <= currentDate) {
    throw new Error('Choose a future date and time for a one-time schedule')
  }

  return {
    ...base,
    ...scheduleConfig,
    permissionConfig: input.permissionConfig ?? null,
    mcpServers: input.mcpServers ?? [],
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
    : scheduleMode === 'once'
      ? normalizeOnceConfig(
          input.runAt ?? existing.runAt ?? '',
          input.timezone ?? existing.timezone ?? DEFAULT_CRON_TIMEZONE,
        )
      : normalizeIntervalConfig(
          input.intervalMinutes ?? existing.intervalMinutes ?? 60,
          currentDate,
        )

  const scheduleChanged =
    input.scheduleMode !== undefined ||
    input.intervalMinutes !== undefined ||
    input.cronExpression !== undefined ||
    input.runAt !== undefined ||
    input.timezone !== undefined

  const recomputeNextRunAt = scheduleChanged || input.enabled !== undefined || existing.nextRunAt === null

  const nextRunAt = enabled
    ? recomputeNextRunAt
      ? scheduleConfig.nextRunAt
      : existing.nextRunAt
    : null

  if (scheduleConfig.scheduleMode === 'once' && enabled && recomputeNextRunAt && scheduleConfig.nextRunAt <= currentDate) {
    throw new Error('Choose a future date and time for a one-time schedule')
  }

  return {
    name: input.name?.trim() || existing.name,
    description: input.description === undefined ? existing.description : (input.description?.trim() || null),
    enabled,
    showInInbox: input.showInInbox ?? existing.showInInbox,
    scheduleMode: scheduleConfig.scheduleMode,
    intervalMinutes: scheduleConfig.intervalMinutes,
    cronExpression: scheduleConfig.cronExpression,
    runAt: scheduleConfig.runAt,
    timezone: scheduleConfig.timezone,
    agentSlug: input.agentSlug === undefined ? existing.agentSlug : (input.agentSlug?.trim() || null),
    prompt: input.prompt?.trim() || existing.prompt,
    model: input.model === undefined ? existing.model : (input.model?.trim() || null),
    skillMetadata: input.skillMetadata !== undefined ? input.skillMetadata : existing.skillMetadata,
    permissionConfig: input.permissionConfig === undefined ? existing.permissionConfig : (input.permissionConfig ?? null),
    mcpServers: input.mcpServers ?? existing.mcpServers,
    branch: input.branch === undefined ? existing.branch : (input.branch?.trim() || null),
    workspaceMode: input.workspaceMode ?? existing.workspaceMode,
    sandbox: input.sandbox !== undefined ? input.sandbox : existing.sandbox,
    ...(input.directory !== undefined || existing.directory !== undefined
      ? { directory: input.directory === undefined ? (existing.directory ?? null) : (input.directory?.trim() || null) }
      : {}),
    nextRunAt,
  }
}
