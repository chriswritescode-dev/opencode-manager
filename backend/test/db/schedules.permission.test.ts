import { describe, expect, it, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createScheduleJob, getScheduleJobById, updateScheduleJob } from '../../src/db/schedules'
import type { ScheduleJobPersistenceInput } from '../../src/services/schedule-config'

describe('schedule permission config persistence', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = OFF')
    migrate(db, allMigrations)

    const now = Date.now()
    db.exec(
      `INSERT INTO repos (id, repo_url, local_path, branch, default_branch, clone_status, cloned_at)
       VALUES (1, 'https://github.com/test/repo', 'repos/test', 'main', 'main', 'ready', ${now})`,
    )
  })

  const baseInput = (overrides: Partial<ScheduleJobPersistenceInput> = {}): ScheduleJobPersistenceInput => ({
    name: 'Permission test job',
    description: null,
    enabled: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: 'Run a permission test',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    branch: null,
    nextRunAt: Date.now() + 3600000,
    ...overrides,
  })

  it('round-trips permissionConfig when set on create', () => {
    const config = {
      allowExternalDirectory: true,
      bashDenyPatterns: ['rm -rf /'],
    }
    const created = createScheduleJob(db, 1, baseInput({ permissionConfig: config }))

    expect(created.permissionConfig).toEqual(config)

    const fetched = getScheduleJobById(db, 1, created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.permissionConfig).toEqual(config)
  })

  it('returns null permissionConfig when not provided on create', () => {
    const created = createScheduleJob(db, 1, baseInput())

    expect(created.permissionConfig).toBeNull()

    const fetched = getScheduleJobById(db, 1, created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.permissionConfig).toBeNull()
  })

  it('updates permissionConfig independently of other fields', () => {
    const created = createScheduleJob(db, 1, baseInput())
    expect(created.permissionConfig).toBeNull()

    const config = {
      allowExternalDirectory: false,
      bashDenyPatterns: ['sudo rm -rf *'],
    }
    const updated = updateScheduleJob(db, 1, created.id, baseInput({ permissionConfig: config }))
    expect(updated).not.toBeNull()
    expect(updated!.permissionConfig).toEqual(config)

    // Verify other fields are unchanged
    expect(updated!.name).toBe('Permission test job')
    expect(updated!.prompt).toBe('Run a permission test')
  })

  it('clears permissionConfig when set to null on update', () => {
    const config = { allowExternalDirectory: true, bashDenyPatterns: [] }
    const created = createScheduleJob(db, 1, baseInput({ permissionConfig: config }))
    expect(created.permissionConfig).toEqual(config)

    const updated = updateScheduleJob(db, 1, created.id, baseInput({ permissionConfig: null }))
    expect(updated).not.toBeNull()
    expect(updated!.permissionConfig).toBeNull()
  })

  it('preserves permissionConfig when updating other fields', () => {
    const config = { allowExternalDirectory: false, bashDenyPatterns: ['rm -rf *'] }
    const created = createScheduleJob(db, 1, baseInput({ permissionConfig: config }))
    expect(created.permissionConfig).toEqual(config)

    const updated = updateScheduleJob(db, 1, created.id, {
      ...baseInput({ permissionConfig: config }),
      name: 'Updated name',
      prompt: 'Updated prompt',
    })
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('Updated name')
    expect(updated!.prompt).toBe('Updated prompt')
    expect(updated!.permissionConfig).toEqual(config)
  })
})
