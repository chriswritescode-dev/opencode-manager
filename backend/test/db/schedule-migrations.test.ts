import { afterEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { z } from 'zod'
import migration007 from '../../src/db/migrations/007-schedules'
import migration008 from '../../src/db/migrations/008-schedule-cron-support'
import migration015 from '../../src/db/migrations/015-schedule-worktree-isolation'
import migration021 from '../../src/db/migrations/021-drop-schedule-run-workspace-id'
import migration022 from '../../src/db/migrations/022-schedule-runs-session-index'
import migration024 from '../../src/db/migrations/024-schedule-runs-viewed-at'
import migration202610251900 from '../../src/db/migrations/202610251900-schedule-sandbox-config'
import migration202610271800 from '../../src/db/migrations/202610271800-schedule-show-in-inbox'
import { selectRow, selectRows, selectTableColumns } from '../../src/db/rows'

const IndexInfoSchema = z.object({ name: z.string() })
const IndexColumnSchema = z.object({ name: z.string().nullable() })

const LegacyJobRowSchema = z.object({
  name: z.string(),
  interval_minutes: z.number().nullable(),
  schedule_mode: z.string(),
  cron_expression: z.string().nullable(),
  timezone: z.string().nullable(),
  prompt: z.string(),
})

const ScheduleRunWorktreeRowSchema = z.object({
  id: z.number(),
  worktree_path: z.string().nullable(),
  run_branch: z.string().nullable(),
})

const LegacyScheduleRunRowSchema = z.object({
  id: z.number(),
  worktree_path: z.string().nullable(),
})

const ScheduleRunViewedRowSchema = z.object({
  id: z.number(),
  viewed_at: z.number().nullable(),
})

const ShowInInboxRowSchema = z.object({ show_in_inbox: z.number() })

function tableIndexNames(db: Database, table: string): string[] {
  return selectRows(db, IndexInfoSchema, `PRAGMA index_list(${table})`).map((index) => index.name)
}

function indexColumnNames(db: Database, index: string): string[] {
  return selectRows(db, IndexColumnSchema, `PRAGMA index_info(${index})`)
    .flatMap((column) => (column.name === null ? [] : [column.name]))
}

function tableColumnNames(db: Database, table: string): string[] {
  return selectTableColumns(db, table).map((column) => column.name)
}

function createLegacyScheduleJobs(db: Database): void {
  db.run(`
    CREATE TABLE schedule_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      interval_minutes INTEGER NOT NULL,
      agent_slug TEXT,
      prompt TEXT NOT NULL,
      model TEXT,
      skill_metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER
    )
  `)
}

function createScheduleRuns(db: Database, extraColumns = ''): void {
  db.run(`CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, session_id TEXT, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER${extraColumns})`)
}

describe('migration 007 - schedules', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('creates schedule jobs with a nullable interval and the run tables', () => {
    db = new Database(':memory:')

    migration007.up(db)

    const jobColumns = selectTableColumns(db, 'schedule_jobs')
    expect(jobColumns.find((column) => column.name === 'interval_minutes')?.notnull).toBe(0)
    expect(tableColumnNames(db, 'schedule_runs')).toEqual(expect.arrayContaining(['job_id', 'repo_id', 'trigger_source', 'status', 'session_id']))
    expect(tableIndexNames(db, 'schedule_jobs')).toEqual(
      expect.arrayContaining(['idx_schedule_jobs_repo', 'idx_schedule_jobs_next_run']),
    )
  })
})

describe('migration 008 - schedule cron support', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('creates both tables from scratch when schedule_jobs does not exist', () => {
    db = new Database(':memory:')

    migration008.up(db)

    const byName = new Map(selectTableColumns(db, 'schedule_jobs').map((column) => [column.name, column]))
    expect(byName.get('schedule_mode')).toMatchObject({ notnull: 1, dflt_value: "'interval'" })
    expect(byName.has('cron_expression')).toBe(true)
    expect(byName.has('timezone')).toBe(true)
    expect(byName.get('interval_minutes')?.notnull).toBe(0)
    expect(tableColumnNames(db, 'schedule_runs')).toEqual(expect.arrayContaining(['job_id', 'trigger_source', 'status']))
    expect(tableIndexNames(db, 'schedule_jobs')).toEqual(
      expect.arrayContaining(['idx_schedule_jobs_repo', 'idx_schedule_jobs_next_run']),
    )
  })

  it('rebuilds a legacy job table as interval-scheduled and preserves its rows', () => {
    db = new Database(':memory:')
    createLegacyScheduleJobs(db)
    db.run(`
      INSERT INTO schedule_jobs (repo_id, name, interval_minutes, prompt, created_at, updated_at)
      VALUES (1, 'Legacy job', 30, 'Run it', 1, 2)
    `)

    migration008.up(db)

    expect(tableColumnNames(db, 'schedule_jobs')).toEqual(expect.arrayContaining(['schedule_mode', 'cron_expression', 'timezone']))
    expect(
      selectRow(db, LegacyJobRowSchema, 'SELECT name, interval_minutes, schedule_mode, cron_expression, timezone, prompt FROM schedule_jobs'),
    ).toEqual({
      name: 'Legacy job',
      interval_minutes: 30,
      schedule_mode: 'interval',
      cron_expression: null,
      timezone: null,
      prompt: 'Run it',
    })
  })

  it('leaves an already migrated table untouched', () => {
    db = new Database(':memory:')
    createLegacyScheduleJobs(db)
    db.run(`
      INSERT INTO schedule_jobs (repo_id, name, interval_minutes, prompt, created_at, updated_at)
      VALUES (1, 'Legacy job', 30, 'Run it', 1, 2)
    `)
    migration008.up(db)

    migration008.up(db)

    expect(tableColumnNames(db, 'schedule_jobs').filter((name) => name === 'schedule_mode')).toHaveLength(1)
    expect(selectRow(db, LegacyJobRowSchema, 'SELECT name, interval_minutes, schedule_mode, cron_expression, timezone, prompt FROM schedule_jobs')).toMatchObject({
      name: 'Legacy job',
      interval_minutes: 30,
    })
  })
})

describe('migration 015 - schedule worktree isolation', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('adds branch to jobs and worktree columns to runs', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, repo_id INTEGER, name TEXT)')
    createScheduleRuns(db)

    migration015.up(db)

    expect(tableColumnNames(db, 'schedule_jobs')).toContain('branch')
    expect(tableColumnNames(db, 'schedule_runs')).toEqual(
      expect.arrayContaining(['run_branch', 'commit_hash', 'worktree_path']),
    )
  })

  it('does not duplicate columns that already exist', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, repo_id INTEGER, branch TEXT)')
    createScheduleRuns(db, ', run_branch TEXT, commit_hash TEXT, worktree_path TEXT')
    db.run("INSERT INTO schedule_runs (id, session_id, status, started_at, run_branch, worktree_path) VALUES (1, 'ses_1', 'running', 10, 'feature-x', '/wt/1')")

    migration015.up(db)

    expect(tableColumnNames(db, 'schedule_jobs').filter((name) => name === 'branch')).toHaveLength(1)
    expect(selectRow(db, ScheduleRunWorktreeRowSchema, 'SELECT id, worktree_path, run_branch FROM schedule_runs')).toEqual({
      id: 1,
      worktree_path: '/wt/1',
      run_branch: 'feature-x',
    })
  })
})

describe('migration 021 - drop schedule run workspace id', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('drops the column and preserves the remaining run data on a real database', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, worktree_path TEXT, workspace_id TEXT)')
    db.run("INSERT INTO schedule_runs (id, worktree_path, workspace_id) VALUES (1, '/wt/1', 'wrk_1')")

    migration021.up(db)
    migration021.up(db)

    expect(tableColumnNames(db, 'schedule_runs')).not.toContain('workspace_id')
    expect(tableColumnNames(db, 'schedule_runs')).toContain('worktree_path')
    expect(selectRow(db, LegacyScheduleRunRowSchema, 'SELECT id, worktree_path FROM schedule_runs WHERE id = 1'))
      .toEqual({ id: 1, worktree_path: '/wt/1' })
  })

  it('skips the ALTER TABLE when workspace_id is already gone', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_runs (id INTEGER PRIMARY KEY, worktree_path TEXT)')
    db.run("INSERT INTO schedule_runs (id, worktree_path) VALUES (1, '/wt/1')")

    migration021.up(db)

    expect(tableColumnNames(db, 'schedule_runs')).toEqual(['id', 'worktree_path'])
    expect(selectRow(db, LegacyScheduleRunRowSchema, 'SELECT id, worktree_path FROM schedule_runs')).toEqual({
      id: 1,
      worktree_path: '/wt/1',
    })
  })
})

describe('migration 022 - schedule run session index', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('creates the composite session index on schedule_runs', () => {
    db = new Database(':memory:')
    createScheduleRuns(db)

    migration022.up(db)

    expect(tableIndexNames(db, 'schedule_runs')).toContain('idx_schedule_runs_session')
    expect(indexColumnNames(db, 'idx_schedule_runs_session')).toEqual(['session_id', 'started_at'])
  })

  it('drops the index on rollback', () => {
    db = new Database(':memory:')
    createScheduleRuns(db)

    migration022.up(db)
    migration022.down(db)

    expect(tableIndexNames(db, 'schedule_runs')).not.toContain('idx_schedule_runs_session')
  })
})

describe('migration 024 - schedule runs viewed at', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('adds viewed_at, backfills finished runs, and creates the unread index', () => {
    db = new Database(':memory:')
    createScheduleRuns(db)
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (1, 'completed', 100, 200)")
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (2, 'failed', 300, 400)")
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (3, 'running', 500, NULL)")
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (4, 'completed', 600, NULL)")

    migration024.up(db)

    expect(tableColumnNames(db, 'schedule_runs')).toContain('viewed_at')
    expect(selectRows(db, ScheduleRunViewedRowSchema, 'SELECT id, viewed_at FROM schedule_runs ORDER BY id')).toEqual([
      { id: 1, viewed_at: 200 },
      { id: 2, viewed_at: 400 },
      { id: 3, viewed_at: null },
      { id: 4, viewed_at: 600 },
    ])
    expect(tableIndexNames(db, 'schedule_runs')).toContain('idx_schedule_runs_unread')
  })

  it('is idempotent and drops the index and column on rollback', () => {
    db = new Database(':memory:')
    createScheduleRuns(db)
    db.run("INSERT INTO schedule_runs (id, status, started_at, finished_at) VALUES (1, 'completed', 100, 200)")

    migration024.up(db)
    migration024.up(db)

    expect(tableColumnNames(db, 'schedule_runs')).toContain('viewed_at')

    migration024.down(db)

    expect(tableColumnNames(db, 'schedule_runs')).not.toContain('viewed_at')
    expect(tableIndexNames(db, 'schedule_runs')).not.toContain('idx_schedule_runs_unread')
  })
})

describe('migration 202610251900 - schedule sandbox config', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('adds the nullable sandbox_config column and is idempotent', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, name TEXT)')

    migration202610251900.up(db)
    migration202610251900.up(db)

    const column = selectTableColumns(db, 'schedule_jobs').find((entry) => entry.name === 'sandbox_config')
    expect(column).toMatchObject({ notnull: 0, dflt_value: null })
  })

  it('drops the column on rollback', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, name TEXT)')

    migration202610251900.up(db)
    migration202610251900.down(db)

    expect(tableColumnNames(db, 'schedule_jobs')).not.toContain('sandbox_config')
  })
})

describe('migration 202610271800 - schedule show in inbox', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  it('adds the show_in_inbox column defaulting existing rows to 1 and is idempotent', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, name TEXT)')
    db.run("INSERT INTO schedule_jobs (id, name) VALUES (1, 'Existing job')")

    migration202610271800.up(db)
    migration202610271800.up(db)

    expect(tableColumnNames(db, 'schedule_jobs')).toContain('show_in_inbox')
    expect(selectRow(db, ShowInInboxRowSchema, 'SELECT show_in_inbox FROM schedule_jobs WHERE id = 1')).toEqual({ show_in_inbox: 1 })
  })

  it('drops the column on rollback', () => {
    db = new Database(':memory:')
    db.run('CREATE TABLE schedule_jobs (id INTEGER PRIMARY KEY, name TEXT)')

    migration202610271800.up(db)
    migration202610271800.down(db)

    expect(tableColumnNames(db, 'schedule_jobs')).not.toContain('show_in_inbox')
  })
})
