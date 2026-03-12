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

export type PromptTemplateOption = {
  id: string
  title: string
  category: string
  cadenceHint: string
  suggestedName: string
  suggestedDescription: string
  description: string
  prompt: string
}

export const promptTemplateOptions: PromptTemplateOption[] = [
  {
    id: 'repo-health-report',
    title: 'Repo Health Report',
    category: 'Health',
    cadenceHint: 'Weekly',
    suggestedName: 'Weekly repo health report',
    suggestedDescription: 'Summarize code health, risk areas, and the next highest-leverage follow-ups.',
    description: 'A broad weekly review of project health, risks, and recommended next actions.',
    prompt: [
      'Review this repository and prepare a concise weekly health report.',
      '',
      'Focus on:',
      '- overall code health and maintainability signals',
      '- risky or stale areas in the codebase',
      '- flaky, fragile, or untested workflows',
      '- notable recent drift in tooling, scripts, or structure',
      '',
      'Do not modify files or create commits.',
      '',
      'Return the result in these sections:',
      '1. Overall Status',
      '2. Key Risks',
      '3. What Changed or Drifted',
      '4. Recommended Next Actions',
    ].join('\n'),
  },
  {
    id: 'dependency-watch',
    title: 'Dependency Watchlist',
    category: 'Maintenance',
    cadenceHint: 'Weekly',
    suggestedName: 'Dependency watchlist',
    suggestedDescription: 'Review dependency health, upgrade pressure, and risky package drift.',
    description: 'Surfaces outdated, risky, or inconsistent dependencies and upgrade priorities.',
    prompt: [
      'Audit this repository for dependency risk and upgrade pressure.',
      '',
      'Inspect package manifests, lockfiles, build tooling, runtime dependencies, and obvious version drift.',
      '',
      'Focus on:',
      '- outdated or inconsistent package versions',
      '- packages that look risky, abandoned, duplicated, or unnecessary',
      '- tooling mismatches that could cause local vs CI drift',
      '- high-priority upgrades to tackle next',
      '',
      'Do not change files.',
      '',
      'Return:',
      '1. Highest Priority Upgrades',
      '2. Risky or Inconsistent Dependencies',
      '3. Tooling Drift',
      '4. Suggested Upgrade Order',
    ].join('\n'),
  },
  {
    id: 'release-readiness',
    title: 'Release Readiness Review',
    category: 'Release',
    cadenceHint: 'Before release',
    suggestedName: 'Release readiness review',
    suggestedDescription: 'Check whether the repo looks ready to ship and what could block release confidence.',
    description: 'A pre-release checkpoint for blockers, missing validation, and confidence gaps.',
    prompt: [
      'Review this repository for release readiness.',
      '',
      'Focus on anything that would reduce confidence in shipping soon, including:',
      '- missing validation, tests, or smoke coverage',
      '- fragile configuration or deployment assumptions',
      '- unfinished, ambiguous, or risky recent work',
      '- docs or scripts that appear stale relative to the implementation',
      '',
      'Do not edit files.',
      '',
      'Return:',
      '1. Release Confidence',
      '2. Blockers',
      '3. Follow-ups Before Shipping',
      '4. Nice-to-have Cleanup After Release',
    ].join('\n'),
  },
  {
    id: 'test-stability-audit',
    title: 'Test Stability Audit',
    category: 'Quality',
    cadenceHint: 'Weekly',
    suggestedName: 'Test stability audit',
    suggestedDescription: 'Find flaky areas, missing coverage signals, and brittle testing patterns.',
    description: 'Looks at test quality, slow paths, brittle coverage, and likely flaky areas.',
    prompt: [
      'Inspect this repository for test stability and coverage risk.',
      '',
      'Focus on:',
      '- flaky or brittle test patterns',
      '- important product areas with weak or missing coverage',
      '- slow or overcomplicated test flows',
      '- test setup/config problems that could cause false confidence',
      '',
      'Do not modify files.',
      '',
      'Return:',
      '1. Confidence Gaps',
      '2. Flaky or Fragile Areas',
      '3. Coverage Priorities',
      '4. Suggested Test Improvements',
    ].join('\n'),
  },
  {
    id: 'docs-drift-review',
    title: 'Docs Drift Review',
    category: 'Docs',
    cadenceHint: 'Biweekly',
    suggestedName: 'Docs drift review',
    suggestedDescription: 'Check whether README, setup steps, and docs still match the current repo.',
    description: 'Finds README/setup/documentation drift relative to the actual codebase.',
    prompt: [
      'Review this repository for documentation drift.',
      '',
      'Compare README files, setup instructions, scripts, and other repo docs against the actual implementation and project structure.',
      '',
      'Focus on:',
      '- stale setup or run instructions',
      '- missing documentation for important workflows',
      '- docs that no longer match the codebase structure or tooling',
      '- confusing or duplicated documentation',
      '',
      'Do not edit files.',
      '',
      'Return:',
      '1. Docs That Look Stale',
      '2. Missing Documentation',
      '3. Confusing or Conflicting Guidance',
      '4. Suggested Documentation Updates',
    ].join('\n'),
  },
  {
    id: 'tech-debt-triage',
    title: 'Tech Debt Triage',
    category: 'Planning',
    cadenceHint: 'Weekly',
    suggestedName: 'Tech debt triage',
    suggestedDescription: 'Identify the most expensive sources of drag and rank cleanup opportunities.',
    description: 'Ranks the most valuable cleanup and refactor opportunities in the repo.',
    prompt: [
      'Review this repository and identify the most important technical debt to address next.',
      '',
      'Focus on debt that creates drag for delivery, reliability, or maintainability, such as:',
      '- duplicated logic or tangled ownership',
      '- brittle architecture seams',
      '- outdated patterns or confusing abstractions',
      '- hotspots that are hard to safely change',
      '',
      'Do not make changes.',
      '',
      'Return:',
      '1. Top Technical Debt Items',
      '2. Why Each Item Matters',
      '3. Cost vs Impact',
      '4. Recommended Cleanup Order',
    ].join('\n'),
  },
  {
    id: 'security-config-review',
    title: 'Security and Config Review',
    category: 'Security',
    cadenceHint: 'Weekly',
    suggestedName: 'Security and config review',
    suggestedDescription: 'Inspect obvious security, secrets, and environment/config handling risks.',
    description: 'Looks for obvious secrets, auth, and configuration handling issues.',
    prompt: [
      'Inspect this repository for obvious security and configuration handling risks.',
      '',
      'Focus on:',
      '- secrets or credentials handling problems',
      '- risky defaults in environment or auth configuration',
      '- places where permission checks or trust assumptions look weak',
      '- config sprawl that could cause unsafe deployments',
      '',
      'Stay read-only. Do not modify files.',
      '',
      'Return:',
      '1. High-Risk Findings',
      '2. Medium-Risk Findings',
      '3. Configuration Concerns',
      '4. Recommended Fixes',
    ].join('\n'),
  },
  {
    id: 'ci-ops-review',
    title: 'CI and Ops Review',
    category: 'Operations',
    cadenceHint: 'Weekly',
    suggestedName: 'CI and ops review',
    suggestedDescription: 'Check CI, scripts, and operational workflows for fragility or drift.',
    description: 'Surfaces friction or fragility in CI, automation, and repo operations.',
    prompt: [
      'Review this repository for CI, automation, and operational workflow issues.',
      '',
      'Focus on:',
      '- brittle build or test assumptions',
      '- scripts that look stale, redundant, or inconsistent',
      '- automation that appears slow, noisy, or easy to break',
      '- workflow gaps that could hurt developer reliability',
      '',
      'Do not edit files.',
      '',
      'Return:',
      '1. Operational Risks',
      '2. CI or Automation Drift',
      '3. Reliability Improvements',
      '4. Highest-Leverage Next Steps',
    ].join('\n'),
  },
  {
    id: 'onboarding-brief',
    title: 'Onboarding Brief',
    category: 'Knowledge',
    cadenceHint: 'Monthly',
    suggestedName: 'Onboarding brief refresh',
    suggestedDescription: 'Produce a concise orientation summary for someone new to the repo.',
    description: 'Creates a concise orientation guide for engineers who are new to the repo.',
    prompt: [
      'Prepare an onboarding brief for an engineer who is new to this repository.',
      '',
      'Focus on:',
      '- the repo structure and major areas of responsibility',
      '- the core development workflows and important commands',
      '- risky or confusing areas worth knowing early',
      '- where a new engineer should start reading or exploring',
      '',
      'Do not modify files.',
      '',
      'Return:',
      '1. What This Repo Does',
      '2. Important Areas to Know',
      '3. Local Workflow Cheatsheet',
      '4. Common Pitfalls and First Reading List',
    ].join('\n'),
  },
  {
    id: 'memory-candidate-review',
    title: 'Memory Candidate Review',
    category: 'Knowledge',
    cadenceHint: 'Biweekly',
    suggestedName: 'Memory candidate review',
    suggestedDescription: 'Identify stable conventions, decisions, and context worth preserving as memory.',
    description: 'Great for repos using durable memory or team conventions that should be captured.',
    prompt: [
      'Review this repository and identify durable knowledge worth preserving as long-lived memory.',
      '',
      'Focus on conventions, architectural decisions, recurring workflows, and stable context that future sessions should know.',
      '',
      'Do not create or update memory directly. Just recommend candidates.',
      '',
      'Return:',
      '1. Candidate Conventions',
      '2. Candidate Decisions',
      '3. Candidate Context',
      '4. Why Each Item Should Be Preserved',
    ].join('\n'),
  },
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
