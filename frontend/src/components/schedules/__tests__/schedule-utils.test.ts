import { describe, expect, it } from 'vitest'
import {
  detectSchedulePreset,
  formatDraftScheduleSummary,
  formatOnceRunAt,
  formatRunDuration,
  formatScheduleInbox,
  formatScheduleShortLabel,
  formatScheduleSummary,
  getDefaultOnceRunAt,
  matchesScheduleJobSearch,
  toUpdateScheduleRequest,
} from '@/components/schedules/schedule-utils'
import type { CreateScheduleJobRequest, ScheduleJob } from '@opencode-manager/shared/types'

function createJob(overrides?: Partial<ScheduleJob>): ScheduleJob {
  return {
    id: 1,
    repoId: 1,
    name: 'Nightly health check',
    description: null,
    enabled: true,
    showInInbox: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    runAt: null,
    timezone: null,
    agentSlug: null,
    prompt: 'Check the repo.',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    mcpServers: [],
    branch: null,
    workspaceMode: 'worktree',
    sandbox: null,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  }
}

describe('formatRunDuration', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatRunDuration({ startedAt: 0, finishedAt: 45_000 })).toBe('45s')
    expect(formatRunDuration({ startedAt: 0, finishedAt: 192_000 })).toBe('3m 12s')
    expect(formatRunDuration({ startedAt: 0, finishedAt: 3_840_000 })).toBe('1h 4m')
  })

  it('measures running runs against now', () => {
    expect(formatRunDuration({ startedAt: 1_000, finishedAt: null }, 31_000)).toBe('30s')
  })
})

describe('formatScheduleInbox', () => {
  it('labels every run versus failures only', () => {
    expect(formatScheduleInbox(true)).toBe('Every run')
    expect(formatScheduleInbox(false)).toBe('Failures only')
  })
})

describe('matchesScheduleJobSearch', () => {
  const job = { name: 'Docs drift review', description: 'Check README drift', repoName: 'vllm' } as ScheduleJob & { repoName: string }

  it('matches name, description, and repo case-insensitively', () => {
    expect(matchesScheduleJobSearch(job, 'DRIFT')).toBe(true)
    expect(matchesScheduleJobSearch(job, 'readme')).toBe(true)
    expect(matchesScheduleJobSearch(job, 'vllm')).toBe(true)
    expect(matchesScheduleJobSearch(job, 'triage')).toBe(false)
  })

  it('matches everything for a blank term', () => {
    expect(matchesScheduleJobSearch(job, '   ')).toBe(true)
  })
})

describe('getDefaultOnceRunAt', () => {
  it('returns tomorrow at 09:00 from local date parts', () => {
    expect(getDefaultOnceRunAt(new Date(2026, 0, 15, 23, 30))).toBe('2026-01-16T09:00')
  })
})

describe('detectSchedulePreset', () => {
  it('returns once with the job run time and timezone', () => {
    const result = detectSchedulePreset(createJob({ scheduleMode: 'once', runAt: '2026-11-08T09:00', timezone: 'Europe/Berlin' }))

    expect(result.preset).toBe('once')
    expect(result.runAt).toBe('2026-11-08T09:00')
    expect(result.timezone).toBe('Europe/Berlin')
  })

  it('returns a default once run time for a non-once job', () => {
    const result = detectSchedulePreset(createJob({ scheduleMode: 'interval' }))

    expect(result.preset).not.toBe('once')
    expect(result.runAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

describe('once schedule labels', () => {
  const job = createJob({ scheduleMode: 'once', runAt: '2026-11-08T09:00', timezone: 'Europe/Berlin' })

  it('summarizes a once job with its timezone', () => {
    expect(formatScheduleSummary(job)).toBe(`Once · ${formatOnceRunAt('2026-11-08T09:00')} - Europe/Berlin`)
  })

  it('labels a once job without its timezone', () => {
    expect(formatScheduleShortLabel(job)).toBe(`Once · ${formatOnceRunAt('2026-11-08T09:00')}`)
  })

  it('previews a once draft as turning off after the run', () => {
    expect(formatDraftScheduleSummary({
      preset: 'once',
      intervalMinutes: '',
      timeOfDay: '',
      hourlyMinute: '',
      weeklyDays: [],
      monthlyDay: '',
      cronExpression: '',
      runAt: '2026-11-08T09:00',
      timezone: 'Europe/Berlin',
    })).toBe(`Runs once on ${formatOnceRunAt('2026-11-08T09:00')} - Europe/Berlin, then turns off.`)
  })
})

describe('toUpdateScheduleRequest', () => {
  it('keeps the once run time and clears interval and cron', () => {
    const request = {
      name: 'Once job',
      prompt: 'Check the repo.',
      scheduleMode: 'once',
      runAt: '2026-11-08T09:00',
      timezone: 'Europe/Berlin',
    } as CreateScheduleJobRequest

    const result = toUpdateScheduleRequest(request)

    expect(result.intervalMinutes).toBeNull()
    expect(result.cronExpression).toBeNull()
    expect(result.runAt).toBe('2026-11-08T09:00')
    expect(result.timezone).toBe('Europe/Berlin')
  })

  it('clears the once run time and interval for a cron request', () => {
    const request = {
      name: 'Cron job',
      prompt: 'Check the repo.',
      scheduleMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
    } as CreateScheduleJobRequest

    const result = toUpdateScheduleRequest(request)

    expect(result.intervalMinutes).toBeNull()
    expect(result.runAt).toBeNull()
  })

  it('clears cron, timezone, and the once run time for an interval request', () => {
    const request = {
      name: 'Interval job',
      prompt: 'Check the repo.',
      scheduleMode: 'interval',
      intervalMinutes: 60,
    } as CreateScheduleJobRequest

    const result = toUpdateScheduleRequest(request)

    expect(result.cronExpression).toBeNull()
    expect(result.timezone).toBeNull()
    expect(result.runAt).toBeNull()
  })
})
