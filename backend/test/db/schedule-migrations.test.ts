import { describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import migration007 from '../../src/db/migrations/007-schedules'
import migration008 from '../../src/db/migrations/008-schedule-cron-support'
import migration015 from '../../src/db/migrations/015-schedule-worktree-isolation'
import migration021 from '../../src/db/migrations/021-drop-schedule-run-workspace-id'

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
