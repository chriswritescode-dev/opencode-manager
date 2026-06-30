import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  insertUpgradeJob,
  updateUpgradeJob,
  getLatestUpgradeJob,
  getActiveUpgradeJob,
} from '../../src/db/manager-upgrade'

describe('manager upgrade jobs', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = OFF')
    migrate(db, allMigrations)
  })

  it('inserts a job and getLatestUpgradeJob returns it with camelCase fields', () => {
    const now = Date.now()

    const job = insertUpgradeJob(db, {
      status: 'pending',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      targetImage: 'opencode-manager:latest',
      startedAt: now,
    })

    expect(job.id).toBeGreaterThan(0)
    expect(job.status).toBe('pending')
    expect(job.fromVersion).toBe('1.0.0')
    expect(job.toVersion).toBe('2.0.0')
    expect(job.targetImage).toBe('opencode-manager:latest')
    expect(job.startedAt).toBe(now)
    expect(job.finishedAt).toBeNull()
    expect(job.error).toBeNull()

    const latest = getLatestUpgradeJob(db)
    expect(latest).not.toBeNull()
    expect(latest!.id).toBe(job.id)
    expect(latest!.status).toBe('pending')
    expect(latest!.fromVersion).toBe('1.0.0')
    expect(latest!.toVersion).toBe('2.0.0')
    expect(latest!.targetImage).toBe('opencode-manager:latest')
    expect(latest!.startedAt).toBe(now)
    expect(latest!.finishedAt).toBeNull()
    expect(latest!.error).toBeNull()
  })

  it('getActiveUpgradeJob returns a recreating job and null after it is patched to completed', () => {
    const now = Date.now()

    const job = insertUpgradeJob(db, {
      status: 'recreating',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      startedAt: now,
    })

    // Should be found as active
    const active = getActiveUpgradeJob(db)
    expect(active).not.toBeNull()
    expect(active!.id).toBe(job.id)
    expect(active!.status).toBe('recreating')

    // Patch to completed
    updateUpgradeJob(db, job.id, { status: 'completed', finishedAt: now + 1000, error: null })

    // Should no longer be active
    const afterPatch = getActiveUpgradeJob(db)
    expect(afterPatch).toBeNull()

    // getLatestUpgradeJob still returns it with updated fields
    const latest = getLatestUpgradeJob(db)
    expect(latest).not.toBeNull()
    expect(latest!.status).toBe('completed')
    expect(latest!.finishedAt).toBe(now + 1000)
  })
})
