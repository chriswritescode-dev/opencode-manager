import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrate, type Migration } from '../../src/db/migration-runner'
import { logger } from '../../src/utils/logger'

function makeMigration(version: number, name: string, up: () => void): Migration {
  return { version, name, up, down: () => {} }
}

describe('migrate - version/name mismatch guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns and skips when an applied version was recorded under a different name', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
    db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (15, 'repos-add-name', 0)")

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const up = vi.fn()

    migrate(db, [makeMigration(15, 'schedule-worktree-isolation', up)])

    expect(up).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Migration version 15 is recorded as "repos-add-name" but the code defines "schedule-worktree-isolation"'),
    )
  })

  it('does not warn when recorded names match', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
    db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (15, 'schedule-worktree-isolation', 0)")

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    migrate(db, [makeMigration(15, 'schedule-worktree-isolation', vi.fn())])

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('applies pending migrations and records them', () => {
    const db = new Database(':memory:')
    const up = vi.fn()

    migrate(db, [makeMigration(1, 'base', up)])

    expect(up).toHaveBeenCalledTimes(1)
    const row = db.prepare('SELECT version, name FROM schema_migrations WHERE version = 1').get() as { version: number; name: string }
    expect(row).toEqual({ version: 1, name: 'base' })
  })
})
