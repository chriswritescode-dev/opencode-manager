import { describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import migration from '../../src/db/migrations/202610181320-remote-schedule-targets'

interface ColumnInfo {
  name: string
  notnull: number
}

const MIGRATION_ID = '202610181320-remote-schedule-targets'

function columns(db: Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
}

describe('remote schedule target migration', () => {
  it('preserves jobs and runs while making repo_id nullable', () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, allMigrations.filter((entry) => entry.id !== MIGRATION_ID))

    const now = Date.now()
    db.exec(
      `INSERT INTO repos (id, repo_url, local_path, branch, default_branch, clone_status, cloned_at)
       VALUES (1, 'https://github.com/test/my-repo', 'repos/my-repo', 'main', 'main', 'ready', ${now})`,
    )
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, workspace_mode, created_at, updated_at)
       VALUES (7, 1, 'Local job', 1, 'interval', 'Run it', 'shared-worktree', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO schedule_runs (id, job_id, repo_id, trigger_source, status, started_at, created_at, session_id)
       VALUES (5, 7, 1, 'manual', 'completed', ?, ?, 'ses_local')`,
    ).run(now, now)

    migration.up(db)

    const jobColumns = columns(db, 'schedule_jobs')
    expect(jobColumns.find((column) => column.name === 'repo_id')?.notnull).toBe(0)
    expect(jobColumns.find((column) => column.name === 'server_id')?.notnull).toBe(1)
    expect(jobColumns.some((column) => column.name === 'directory')).toBe(true)

    const runColumns = columns(db, 'schedule_runs')
    expect(runColumns.find((column) => column.name === 'repo_id')?.notnull).toBe(0)
    expect(runColumns.some((column) => column.name === 'server_id')).toBe(true)

    const job = db.prepare('SELECT * FROM schedule_jobs WHERE id = 7').get() as Record<string, unknown>
    expect(job).toMatchObject({
      repo_id: 1,
      server_id: 'local',
      directory: null,
      name: 'Local job',
      workspace_mode: 'shared-worktree',
    })

    const run = db.prepare('SELECT * FROM schedule_runs WHERE id = 5').get() as Record<string, unknown>
    expect(run).toMatchObject({ repo_id: 1, server_id: 'local', session_id: 'ses_local', status: 'completed' })

    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, server_id, directory, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (8, NULL, 'srv_kitchen', '/srv/project', 'Remote job', 1, 'interval', 'Run remotely', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO schedule_runs (id, job_id, repo_id, server_id, trigger_source, status, started_at, created_at)
       VALUES (6, 8, NULL, 'srv_kitchen', 'manual', 'running', ?, ?)`,
    ).run(now, now)

    expect(db.prepare('SELECT COUNT(*) AS count FROM schedule_runs').get()).toEqual({ count: 2 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('is idempotent', () => {
    const db = new Database(':memory:')
    migrate(db, allMigrations)

    const now = Date.now()
    db.prepare(
      `INSERT INTO schedule_jobs (id, repo_id, server_id, directory, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (3, NULL, 'srv_kitchen', '/srv/project', 'Remote job', 1, 'interval', 'Run remotely', ?, ?)`,
    ).run(now, now)

    migration.up(db)

    expect(db.prepare('SELECT COUNT(*) AS count FROM schedule_jobs').get()).toEqual({ count: 1 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
