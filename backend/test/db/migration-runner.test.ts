import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { migrate, type Migration } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { selectRow, selectRows } from '../../src/db/rows'
import { expectLoggedMessage, testLogEntries } from '../helpers/log-assertions'

const AppliedMigrationIdRowSchema = z.object({ id: z.string() })
const TableNameRowSchema = z.object({ name: z.string() })

function makeMigration(id: string, up: () => void = vi.fn(), legacy?: Migration['legacy']): Migration {
  return { id, legacy, up, down: () => {} }
}

function createLegacyTable(db: Database, rows: Array<[number, string]>): void {
  db.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
  rows.forEach(([version, name]) => {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, 0)').run(version, name)
  })
}

function appliedIds(db: Database): string[] {
  return selectRows(db, AppliedMigrationIdRowSchema, 'SELECT id FROM applied_migrations ORDER BY id').map((row) => row.id)
}

describe('migrate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies pending migrations in list order and records them by id', () => {
    const db = new Database(':memory:')
    const order: string[] = []

    migrate(db, [
      makeMigration('202610061345-second', () => order.push('second')),
      makeMigration('202610051200-first', () => order.push('first')),
    ])

    expect(order).toEqual(['second', 'first'])
    expect(appliedIds(db)).toEqual(['202610051200-first', '202610061345-second'])
  })

  it('does not run a migration twice', () => {
    const db = new Database(':memory:')
    const up = vi.fn()

    migrate(db, [makeMigration('202610061345-once', up)])
    migrate(db, [makeMigration('202610061345-once', up)])

    expect(up).toHaveBeenCalledTimes(1)
  })

  it('runs a migration whose old version number another branch already used', () => {
    const db = new Database(':memory:')
    createLegacyTable(db, [[28, 'remote-devices']])
    const up = vi.fn()

    migrate(db, [makeMigration('202610061345-schedule-workspace-mode', up)])

    expect(up).toHaveBeenCalledTimes(1)
  })

  it('adopts numbered migrations recorded in the old version-keyed table', () => {
    const db = new Database(':memory:')
    createLegacyTable(db, [[15, 'schedule-worktree-isolation']])
    const up = vi.fn()

    migrate(db, [makeMigration('015-schedule-worktree-isolation', up, { version: 15, name: 'schedule-worktree-isolation' })])

    expect(up).not.toHaveBeenCalled()
    expect(appliedIds(db)).toEqual(['015-schedule-worktree-isolation'])
    expect(testLogEntries('warn')).toHaveLength(0)
  })

  it('warns and skips when a legacy version was recorded under a different name', () => {
    const db = new Database(':memory:')
    createLegacyTable(db, [[15, 'repos-add-name']])
    const up = vi.fn()

    migrate(db, [makeMigration('015-schedule-worktree-isolation', up, { version: 15, name: 'schedule-worktree-isolation' })])

    expect(up).not.toHaveBeenCalled()
    expectLoggedMessage(
      'Migration version 15 is recorded as "repos-add-name" but the code defines "schedule-worktree-isolation"',
      'warn',
    )
  })

  it('rejects duplicate ids before touching the database', () => {
    const db = new Database(':memory:')
    const up = vi.fn()

    expect(() => migrate(db, [makeMigration('202610061345-a', up), makeMigration('202610061345-a', up)])).toThrow('Duplicate migration id')
    expect(up).not.toHaveBeenCalled()
  })

  it('rolls back and stops when a migration fails', () => {
    const db = new Database(':memory:')
    const later = vi.fn()

    expect(() => migrate(db, [
      makeMigration('202610061345-broken', () => {
        db.run('CREATE TABLE partial (id INTEGER)')
        throw new Error('boom')
      }),
      makeMigration('202610061346-later', later),
    ])).toThrow('boom')

    expect(later).not.toHaveBeenCalled()
    expect(appliedIds(db)).toEqual([])
    expect(selectRow(db, TableNameRowSchema, "SELECT name FROM sqlite_master WHERE name = 'partial'")).toBeNull()
    expectLoggedMessage('Migration 202610061345-broken failed', 'error')
  })
})

describe('allMigrations', () => {
  it('uses timestamp ids for every migration added after the numbered ones', () => {
    const unnumbered = allMigrations.filter((migration) => !migration.legacy)

    expect(unnumbered.length).toBeGreaterThan(0)
    unnumbered.forEach((migration) => {
      expect(migration.id).toMatch(/^\d{12}-[a-z0-9]+(?:-[a-z0-9]+)*$/)
    })
  })
})
