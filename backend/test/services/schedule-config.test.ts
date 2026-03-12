import { describe, expect, it } from 'vitest'
import type { ScheduleJob } from '@opencode-manager/shared/types'
import {
  buildCreateSchedulePersistenceInput,
  buildUpdatedSchedulePersistenceInput,
  computeNextRunAtForJob,
} from '../../src/services/schedule-config'

describe('schedule-config', () => {
  it('builds interval schedule persistence input with trimmed fields', () => {
    const currentDate = Date.UTC(2026, 2, 9, 12, 0, 0)

    const result = buildCreateSchedulePersistenceInput({
      name: '  Daily health check  ',
      description: '  Summarize repo health  ',
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      prompt: '  Review the repository and summarize risks.  ',
      agentSlug: '  code  ',
      model: '  openai/gpt-5  ',
    }, currentDate)

    expect(result).toEqual({
      name: 'Daily health check',
      description: 'Summarize repo health',
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: 'code',
      prompt: 'Review the repository and summarize risks.',
      model: 'openai/gpt-5',
      skillMetadata: undefined,
      nextRunAt: currentDate + 60 * 60_000,
    })
  })

  it('defaults cron schedules to UTC and computes the next run', () => {
    const currentDate = Date.UTC(2026, 2, 9, 8, 15, 0)

    const result = buildCreateSchedulePersistenceInput({
      name: 'Morning report',
      enabled: true,
      scheduleMode: 'cron',
      cronExpression: ' 0 9 * * * ',
      timezone: '   ',
      prompt: 'Generate the daily report.',
    }, currentDate)

    expect(result.scheduleMode).toBe('cron')
    expect(result.cronExpression).toBe('0 9 * * *')
    expect(result.timezone).toBe('UTC')
    expect(result.nextRunAt).toBe(Date.UTC(2026, 2, 9, 9, 0, 0))
  })

  it('preserves the existing next run when only prompt text changes', () => {
    const existing: ScheduleJob = {
      id: 7,
      repoId: 42,
      name: 'Weekly engineering summary',
      description: 'Summarize health',
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Old prompt',
      model: null,
      skillMetadata: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: Date.UTC(2026, 2, 9, 12, 0, 0),
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedSchedulePersistenceInput(existing, {
      prompt: '  New prompt body  ',
    }, Date.UTC(2026, 2, 9, 12, 30, 0))

    expect(result.prompt).toBe('New prompt body')
    expect(result.nextRunAt).toBe(existing.nextRunAt)
  })

  it('normalizes optional text fields when updating a schedule', () => {
    const existing: ScheduleJob = {
      id: 10,
      repoId: 42,
      name: 'Weekly engineering summary',
      description: 'Existing description',
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: 'planner',
      prompt: 'Old prompt',
      model: 'openai/gpt-5-mini',
      skillMetadata: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: Date.UTC(2026, 2, 9, 12, 0, 0),
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedSchedulePersistenceInput(existing, {
      description: '   ',
      agentSlug: '  reviewer  ',
      model: '   ',
    }, Date.UTC(2026, 2, 9, 12, 30, 0))

    expect(result.description).toBeNull()
    expect(result.agentSlug).toBe('reviewer')
    expect(result.model).toBeNull()
  })

  it('recomputes the next run when a disabled schedule is re-enabled', () => {
    const existing: ScheduleJob = {
      id: 8,
      repoId: 42,
      name: 'Paused summary',
      description: null,
      enabled: false,
      scheduleMode: 'interval',
      intervalMinutes: 30,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Run a report',
      model: null,
      skillMetadata: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const currentDate = Date.UTC(2026, 2, 9, 14, 0, 0)
    const result = buildUpdatedSchedulePersistenceInput(existing, {
      enabled: true,
    }, currentDate)

    expect(result.enabled).toBe(true)
    expect(result.nextRunAt).toBe(currentDate + 30 * 60_000)
  })

  it('throws for invalid cron timezones', () => {
    expect(() => buildCreateSchedulePersistenceInput({
      name: 'Invalid timezone',
      enabled: true,
      scheduleMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'Mars/Phobos',
      prompt: 'Test prompt',
    }, Date.UTC(2026, 2, 9, 8, 0, 0))).toThrow('Invalid timezone: Mars/Phobos')
  })

  it('returns null for disabled jobs when computing the next run', () => {
    const job: ScheduleJob = {
      id: 9,
      repoId: 42,
      name: 'Disabled summary',
      description: null,
      enabled: false,
      scheduleMode: 'interval',
      intervalMinutes: 15,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    expect(computeNextRunAtForJob(job, Date.UTC(2026, 2, 9, 12, 0, 0))).toBeNull()
  })
})
