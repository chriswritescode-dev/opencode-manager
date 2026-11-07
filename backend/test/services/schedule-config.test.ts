import { describe, expect, it } from 'vitest'
import type { ScheduleJob } from '@opencode-manager/shared/types'
import {
  buildCreateSchedulePersistenceInput,
  buildUpdatedSchedulePersistenceInput,
  computeNextRunAtForJob,
  resolveOnceRunAtMs,
} from '../../src/services/schedule-config'

describe('schedule-config', () => {
  it('builds interval schedule persistence input with trimmed fields', () => {
    const currentDate = Date.UTC(2026, 2, 9, 12, 0, 0)

    const result = buildCreateSchedulePersistenceInput({
      name: '  Daily health check  ',
      description: '  Summarize repo health  ',
      enabled: true,
      showInInbox: true,
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
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: 'code',
      prompt: 'Review the repository and summarize risks.',
      model: 'openai/gpt-5',
      skillMetadata: undefined,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: currentDate + 60 * 60_000,
    })
  })

  it('defaults cron schedules to UTC and computes the next run', () => {
    const currentDate = Date.UTC(2026, 2, 9, 8, 15, 0)

    const result = buildCreateSchedulePersistenceInput({
      name: 'Morning report',
      enabled: true,
      showInInbox: true,
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
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Old prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
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
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: 'planner',
      prompt: 'Old prompt',
      model: 'openai/gpt-5-mini',
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
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

  it('preserves existing branch when omitted from update', () => {
    const existing: ScheduleJob = {
      id: 11,
      repoId: 42,
      name: 'Branch job',
      description: null,
      enabled: true,
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: 'feature/foo',
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedSchedulePersistenceInput(existing, {
      prompt: 'Updated prompt',
    })

    expect(result.branch).toBe('feature/foo')
  })

  it('preserves showInInbox false when omitted from an update', () => {
    const existing: ScheduleJob = {
      id: 15,
      repoId: 42,
      name: 'Quiet job',
      description: null,
      enabled: true,
      showInInbox: false,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedSchedulePersistenceInput(existing, {
      prompt: 'Updated prompt',
    })

    expect(result.showInInbox).toBe(false)
  })

  it('overrides showInInbox when provided in an update', () => {
    const existing: ScheduleJob = {
      id: 16,
      repoId: 42,
      name: 'Quiet job',
      description: null,
      enabled: true,
      showInInbox: false,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedSchedulePersistenceInput(existing, {
      showInInbox: true,
    })

    expect(result.showInInbox).toBe(true)
  })

  it('overrides branch when provided in update', () => {
    const existing: ScheduleJob = {
      id: 12,
      repoId: 42,
      name: 'Branch job',
      description: null,
      enabled: true,
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedSchedulePersistenceInput(existing, {
      branch: '  main  ',
    })

    expect(result.branch).toBe('main')
  })

  it('clears branch to null when explicitly set to null in update', () => {
    const existing: ScheduleJob = {
      id: 13,
      repoId: 42,
      name: 'Branch job',
      description: null,
      enabled: true,
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: 'feature/foo',
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    const result = buildUpdatedSchedulePersistenceInput(existing, {
      branch: null,
    })

    expect(result.branch).toBeNull()
  })

  it('recomputes the next run when a disabled schedule is re-enabled', () => {
    const existing: ScheduleJob = {
      id: 8,
      repoId: 42,
      name: 'Paused summary',
      description: null,
      enabled: false,
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 30,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Run a report',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
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
      showInInbox: true,
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
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 15,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    }

    expect(computeNextRunAtForJob(job, Date.UTC(2026, 2, 9, 12, 0, 0))).toBeNull()
  })

  describe('one-time schedules', () => {
    const onceJob = (overrides: Partial<ScheduleJob> = {}): ScheduleJob => ({
      id: 20,
      repoId: 42,
      name: 'One-time report',
      description: null,
      enabled: true,
      showInInbox: true,
      scheduleMode: 'once',
      intervalMinutes: null,
      cronExpression: null,
      timezone: 'Europe/Berlin',
      runAt: '2026-11-20T09:00',
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: null,
      nextRunAt: Date.UTC(2026, 10, 20, 8, 0, 0),
      lastRunAt: null,
      createdAt: Date.UTC(2026, 10, 1, 12, 0, 0),
      updatedAt: Date.UTC(2026, 10, 1, 12, 0, 0),
      ...overrides,
    })

    it('builds a once persistence input from a wall-clock date and time', () => {
      const result = buildCreateSchedulePersistenceInput({
        name: 'One-time report',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'once',
        runAt: '2026-11-20T09:00',
        timezone: 'Europe/Berlin',
        prompt: 'Generate the report.',
      }, Date.UTC(2026, 10, 1, 12, 0, 0))

      expect(result.scheduleMode).toBe('once')
      expect(result.runAt).toBe('2026-11-20T09:00')
      expect(result.timezone).toBe('Europe/Berlin')
      expect(result.intervalMinutes).toBeNull()
      expect(result.cronExpression).toBeNull()
      expect(result.nextRunAt).toBe(Date.UTC(2026, 10, 20, 8, 0, 0))
    })

    it('resolves a once time through daylight saving time', () => {
      const result = buildCreateSchedulePersistenceInput({
        name: 'Summer report',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'once',
        runAt: '2026-07-01T09:00',
        timezone: 'Europe/Berlin',
        prompt: 'Generate the summer report.',
      }, Date.UTC(2026, 5, 1, 12, 0, 0))

      expect(result.nextRunAt).toBe(Date.UTC(2026, 6, 1, 7, 0, 0))
    })

    it('rejects an enabled once schedule in the past', () => {
      expect(() => buildCreateSchedulePersistenceInput({
        name: 'Past report',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'once',
        runAt: '2026-11-20T09:00',
        timezone: 'Europe/Berlin',
        prompt: 'Generate the report.',
      }, Date.UTC(2026, 10, 21, 12, 0, 0))).toThrow('Choose a future date and time for a one-time schedule')
    })

    it('rejects a date that does not exist', () => {
      expect(() => buildCreateSchedulePersistenceInput({
        name: 'Impossible report',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'once',
        runAt: '2026-02-30T09:00',
        timezone: 'Europe/Berlin',
        prompt: 'Generate the report.',
      }, Date.UTC(2026, 0, 1, 12, 0, 0))).toThrow('Invalid date and time: 2026-02-30T09:00')
    })

    it('renames a used-up disabled once schedule without recomputing a next run', () => {
      const existing = onceJob({
        enabled: false,
        runAt: '2026-01-05T09:00',
        nextRunAt: null,
      })

      const result = buildUpdatedSchedulePersistenceInput(existing, {
        name: 'Renamed report',
      }, Date.UTC(2026, 5, 1, 12, 0, 0))

      expect(result.name).toBe('Renamed report')
      expect(result.runAt).toBe('2026-01-05T09:00')
      expect(result.nextRunAt).toBeNull()
    })

    it('rejects re-enabling a once schedule whose time has passed', () => {
      const existing = onceJob({
        enabled: false,
        runAt: '2026-01-05T09:00',
        nextRunAt: null,
      })

      expect(() => buildUpdatedSchedulePersistenceInput(existing, {
        enabled: true,
      }, Date.UTC(2026, 5, 1, 12, 0, 0))).toThrow('Choose a future date and time for a one-time schedule')
    })

    it('clears the once date when switching to cron', () => {
      const result = buildUpdatedSchedulePersistenceInput(onceJob(), {
        scheduleMode: 'cron',
        cronExpression: '0 9 * * *',
      }, Date.UTC(2026, 10, 1, 12, 0, 0))

      expect(result.scheduleMode).toBe('cron')
      expect(result.cronExpression).toBe('0 9 * * *')
      expect(result.runAt).toBeNull()
    })

    it('computes the next run for an enabled once job from its date', () => {
      const job = onceJob()

      expect(computeNextRunAtForJob(job, Date.UTC(2026, 10, 1, 12, 0, 0))).toBe(Date.UTC(2026, 10, 20, 8, 0, 0))
      expect(computeNextRunAtForJob(job, Date.UTC(2026, 10, 21, 12, 0, 0))).toBeNull()
    })

    it('requires a stored date and time when computing a once next run', () => {
      expect(() => computeNextRunAtForJob(onceJob({ runAt: null }), Date.UTC(2026, 10, 1, 12, 0, 0)))
        .toThrow('A date and time is required for one-time schedules')
    })
  })

  describe('once time resolution across DST transitions', () => {
    it('moves a skipped New York wall clock forward by the spring-forward gap', () => {
      expect(resolveOnceRunAtMs('2026-03-08T02:30', 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 30))
    })

    it('moves a skipped Berlin wall clock forward by the spring-forward gap', () => {
      expect(resolveOnceRunAtMs('2026-03-29T02:30', 'Europe/Berlin')).toBe(Date.UTC(2026, 2, 29, 1, 30))
    })

    it('resolves an ambiguous New York wall clock to its first occurrence', () => {
      expect(resolveOnceRunAtMs('2026-11-01T01:30', 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30))
    })

    it('resolves an ambiguous Berlin wall clock to its first occurrence', () => {
      expect(resolveOnceRunAtMs('2026-10-25T02:30', 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 25, 0, 30))
    })
  })

  describe('sandbox config', () => {
    const sandbox = { enabled: true, resources: { cpus: 4, memoryMib: 12288 } }

    const existingJob = (sandboxConfig: ScheduleJob['sandbox']): ScheduleJob => ({
      id: 14,
      repoId: 42,
      name: 'Sandbox job',
      description: null,
      enabled: true,
      showInInbox: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      runAt: null,
      agentSlug: null,
      prompt: 'Prompt',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      mcpServers: [],
      branch: null,
      workspaceMode: 'worktree',
      sandbox: sandboxConfig,
      nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
      lastRunAt: null,
      createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    })

    it('defaults sandbox to null when creating a schedule', () => {
      const result = buildCreateSchedulePersistenceInput({
        name: 'Sandbox job',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Prompt',
      })

      expect(result.sandbox).toBeNull()
    })

    it('keeps the provided sandbox when creating a schedule', () => {
      const result = buildCreateSchedulePersistenceInput({
        name: 'Sandbox job',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Prompt',
        sandbox,
      })

      expect(result.sandbox).toEqual(sandbox)
    })

    it('keeps the existing sandbox when omitted from an update', () => {
      const result = buildUpdatedSchedulePersistenceInput(existingJob(sandbox), {
        prompt: 'Updated prompt',
      })

      expect(result.sandbox).toEqual(sandbox)
    })

    it('replaces the sandbox when provided in an update', () => {
      const replacement = { enabled: true, resources: null }
      const result = buildUpdatedSchedulePersistenceInput(existingJob(sandbox), {
        sandbox: replacement,
      })

      expect(result.sandbox).toEqual(replacement)
    })

    it('clears the sandbox when explicitly set to null in an update', () => {
      const result = buildUpdatedSchedulePersistenceInput(existingJob(sandbox), {
        sandbox: null,
      })

      expect(result.sandbox).toBeNull()
    })
  })
})
