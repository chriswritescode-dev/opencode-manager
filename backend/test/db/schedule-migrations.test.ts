import { describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import migration007 from '../../src/db/migrations/007-schedules'
import migration008 from '../../src/db/migrations/008-schedule-cron-support'
import migration015 from '../../src/db/migrations/015-schedule-worktree-isolation'
import migration021 from '../../src/db/migrations/021-drop-schedule-run-workspace-id'
import migration022 from '../../src/db/migrations/022-schedule-runs-session-index'
import migration024 from '../../src/db/migrations/024-schedule-runs-viewed-at'
import migration202610251900 from '../../src/db/migrations/202610251900-schedule-sandbox-config'

describe('schedule migrations', () => {
  it('creates schedule jobs with nullable interval minutes in v7', () => {
    const db = {
      run: vi.fn(),
    }

    migration007.up(db as never)

    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('interval_minutes INTEGER,'))
  })

  it('creates tables from scratch when schedule_jobs does not exist (phantom migration)', () => {
    const db = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info')) {
          return {
            all: vi.fn().mockReturnValue([
              { name: 'interval_minutes', notnull: 0, dflt_value: null },
              { name: 'schedule_mode', notnull: 1, dflt_value: "'interval'" },
              { name: 'cron_expression', notnull: 0, dflt_value: null },
              { name: 'timezone', notnull: 0, dflt_value: null },
            ]),
          }
        }
        return { get: vi.fn().mockReturnValue(undefined) }
      }),
      run: vi.fn(),
    }

    migration008.up(db as never)

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE schedule_jobs'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('schedule_mode TEXT NOT NULL DEFAULT'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('cron_expression TEXT'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('timezone TEXT'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE schedule_runs'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('idx_schedule_jobs_repo'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('idx_schedule_jobs_next_run'))
  })

  it('rebuilds schedule jobs for cron support in v8', () => {
    const db = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return {
            get: vi.fn().mockReturnValue({ name: 'schedule_jobs' }),
          }
        }
        return {
          all: vi.fn().mockReturnValue([
            { name: 'id', notnull: 0, dflt_value: null },
            { name: 'repo_id', notnull: 1, dflt_value: null },
            { name: 'name', notnull: 1, dflt_value: null },
            { name: 'description', notnull: 0, dflt_value: null },
            { name: 'enabled', notnull: 1, dflt_value: 'TRUE' },
            { name: 'interval_minutes', notnull: 1, dflt_value: null },
            { name: 'agent_slug', notnull: 0, dflt_value: null },
            { name: 'prompt', notnull: 1, dflt_value: null },
            { name: 'model', notnull: 0, dflt_value: null },
            { name: 'skill_metadata', notnull: 0, dflt_value: null },
            { name: 'created_at', notnull: 1, dflt_value: null },
            { name: 'updated_at', notnull: 1, dflt_value: null },
            { name: 'last_run_at', notnull: 0, dflt_value: null },
            { name: 'next_run_at', notnull: 0, dflt_value: null },
          ]),
        }
      }),
      run: vi.fn(),
    }

    migration008.up(db as never)

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'))
    expect(db.prepare).toHaveBeenCalledWith('PRAGMA table_info(schedule_jobs)')
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE schedule_jobs_new'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('interval_minutes INTEGER,'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("schedule_mode TEXT NOT NULL DEFAULT 'interval'"))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("'interval'"))
    expect(db.run).toHaveBeenCalledWith('DROP TABLE schedule_jobs')
    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_jobs_new RENAME TO schedule_jobs')
  })
})

describe('migration 015 - schedule worktree isolation', () => {
  it('adds branch column to schedule_jobs and worktree columns to schedule_runs', () => {
    const db = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info(schedule_jobs)')) {
          return {
            all: vi.fn().mockReturnValue([
              { name: 'id', notnull: 1, dflt_value: null },
              { name: 'repo_id', notnull: 1, dflt_value: null },
            ]),
          }
        }
        if (query.includes('PRAGMA table_info(schedule_runs)')) {
          return {
            all: vi.fn().mockReturnValue([
              { name: 'id', notnull: 1, dflt_value: null },
              { name: 'job_id', notnull: 1, dflt_value: null },
            ]),
          }
        }
        return { all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(undefined) }
      }),
      run: vi.fn(),
    }

    migration015.up(db as never)

    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_jobs ADD COLUMN branch TEXT')
    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_runs ADD COLUMN run_branch TEXT')
    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_runs ADD COLUMN commit_hash TEXT')
    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_runs ADD COLUMN worktree_path TEXT')
  })

  it('skips columns that already exist', () => {
    const db = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info(schedule_jobs)')) {
          return {
            all: vi.fn().mockReturnValue([
              { name: 'id', notnull: 1, dflt_value: null },
              { name: 'branch', notnull: 0, dflt_value: null },
            ]),
          }
        }
        if (query.includes('PRAGMA table_info(schedule_runs)')) {
          return {
            all: vi.fn().mockReturnValue([
              { name: 'id', notnull: 1, dflt_value: null },
              { name: 'run_branch', notnull: 0, dflt_value: null },
              { name: 'commit_hash', notnull: 0, dflt_value: null },
              { name: 'worktree_path', notnull: 0, dflt_value: null },
            ]),
          }
        }
        return { all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(undefined) }
      }),
      run: vi.fn(),
    }

    migration015.up(db as never)

    expect(db.run).not.toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE'))
  })
})

describe('migration 021 - drop schedule run workspace id', () => {
  it('drops the workspace_id column when present', () => {
    const db = {
      prepare: vi.fn().mockImplementation(() => ({
        all: vi.fn().mockReturnValue([
          { name: 'id' },
          { name: 'workspace_id' },
        ]),
      })),
      run: vi.fn(),
    }

    migration021.up(db as never)

    expect(db.prepare).toHaveBeenCalledWith('PRAGMA table_info(schedule_runs)')
    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_runs DROP COLUMN workspace_id')
  })

  it('skips the ALTER TABLE when workspace_id is already gone', () => {
    const db = {
      prepare: vi.fn().mockImplementation(() => ({
        all: vi.fn().mockReturnValue([
          { name: 'id' },
          { name: 'worktree_path' },
        ]),
      })),
      run: vi.fn(),
    }

    migration021.up(db as never)

    expect(db.run).not.toHaveBeenCalled()
  })

  it('drops the column and preserves the remaining run data on a real database', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, worktree_path TEXT, workspace_id TEXT)')
    db.run("INSERT INTO schedule_runs (id, worktree_path, workspace_id) VALUES (1, '/wt/1', 'wrk_1')")

    migration021.up(db)
    migration021.up(db)

    const columns = (db.prepare('PRAGMA table_info(schedule_runs)').all() as { name: string }[]).map((column) => column.name)
    expect(columns).not.toContain('workspace_id')
    expect(columns).toContain('worktree_path')

    const row = db.prepare('SELECT id, worktree_path FROM schedule_runs WHERE id = 1').get() as { id: number; worktree_path: string }
    expect(row.worktree_path).toBe('/wt/1')

    db.close()
  })
})

describe('migration 022 - schedule run session index', () => {
  it('creates the composite session index on schedule_runs', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, session_id TEXT, started_at INTEGER NOT NULL)')

    migration022.up(db)

    const indexes = (db.prepare('PRAGMA index_list(schedule_runs)').all() as { name: string }[]).map((index) => index.name)
    expect(indexes).toContain('idx_schedule_runs_session')

    const columns = (db.prepare('PRAGMA index_info(idx_schedule_runs_session)').all() as { name: string }[]).map((column) => column.name)
    expect(columns).toEqual(['session_id', 'started_at'])

    db.close()
  })

  it('drops the index on rollback', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, session_id TEXT, started_at INTEGER NOT NULL)')

    migration022.up(db)
    migration022.down(db)

    const indexes = (db.prepare('PRAGMA index_list(schedule_runs)').all() as { name: string }[]).map((index) => index.name)
    expect(indexes).not.toContain('idx_schedule_runs_session')

    db.close()
  })
})

describe('migration 024 - schedule runs viewed at', () => {
  it('adds viewed_at, backfills finished runs, and creates the unread index', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER)')
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (1, 'completed', 100, 200)")
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (2, 'failed', 300, 400)")
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (3, 'running', 500, NULL)")
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (4, 'completed', 600, NULL)")

    migration024.up(db)

    const columns = (db.prepare('PRAGMA table_info(schedule_runs)').all() as { name: string }[]).map((column) => column.name)
    expect(columns).toContain('viewed_at')

    const rows = db.prepare('SELECT id, viewed_at FROM schedule_runs ORDER BY id').all() as { id: number; viewed_at: number | null }[]
    expect(rows).toEqual([
      { id: 1, viewed_at: 200 },
      { id: 2, viewed_at: 400 },
      { id: 3, viewed_at: null },
      { id: 4, viewed_at: 600 },
    ])

    const indexes = (db.prepare('PRAGMA index_list(schedule_runs)').all() as { name: string }[]).map((index) => index.name)
    expect(indexes).toContain('idx_schedule_runs_unread')

    db.close()
  })

  it('is idempotent and drops the index and column on rollback', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER)')
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (1, 'completed', 100, 200)")

    migration024.up(db)
    migration024.up(db)

    const columns = (db.prepare('PRAGMA table_info(schedule_runs)').all() as { name: string }[]).map((column) => column.name)
    expect(columns).toContain('viewed_at')

    migration024.down(db)

    const droppedColumns = (db.prepare('PRAGMA table_info(schedule_runs)').all() as { name: string }[]).map((column) => column.name)
    expect(droppedColumns).not.toContain('viewed_at')
    const indexes = (db.prepare('PRAGMA index_list(schedule_runs)').all() as { name: string }[]).map((index) => index.name)
    expect(indexes).not.toContain('idx_schedule_runs_unread')

    db.close()
  })
})

describe('migration 202610251900 - schedule sandbox config', () => {
  it('adds the nullable sandbox_config column and is idempotent', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, name TEXT)')

    migration202610251900.up(db)
    migration202610251900.up(db)

    const columns = (db.prepare('PRAGMA table_info(schedule_jobs)').all() as { name: string }[]).map((column) => column.name)
    expect(columns).toContain('sandbox_config')

    db.close()
  })

  it('drops the column on rollback', () => {
    const db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, name TEXT)')

    migration202610251900.up(db)
    migration202610251900.down(db)

    const columns = (db.prepare('PRAGMA table_info(schedule_jobs)').all() as { name: string }[]).map((column) => column.name)
    expect(columns).not.toContain('sandbox_config')

    db.close()
  })
})
