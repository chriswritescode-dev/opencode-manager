import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
}

const migration: Migration = {
  version: 8,
  name: 'schedule-cron-support',

  up(db) {
    const tableInfo = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    const existingColumns = new Set(tableInfo.map((column) => column.name))
    const intervalMinutesColumn = tableInfo.find((column) => column.name === 'interval_minutes')
    const scheduleModeColumn = tableInfo.find((column) => column.name === 'schedule_mode')
    const hasCronColumns = existingColumns.has('schedule_mode') && existingColumns.has('cron_expression') && existingColumns.has('timezone')
    const scheduleModeDefault = scheduleModeColumn?.dflt_value?.replaceAll("'", '')

    if (intervalMinutesColumn?.notnull === 0 && hasCronColumns && scheduleModeDefault === 'interval') {
      return
    }

    db.run(`
      CREATE TABLE schedule_jobs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        interval_minutes INTEGER,
        schedule_mode TEXT NOT NULL DEFAULT 'interval',
        cron_expression TEXT,
        timezone TEXT,
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

    db.run(`
      INSERT INTO schedule_jobs_new (
        id, repo_id, name, description, enabled, interval_minutes, schedule_mode, cron_expression, timezone,
        agent_slug, prompt, model, skill_metadata, created_at, updated_at, last_run_at, next_run_at
      )
      SELECT
        id,
        repo_id,
        name,
        description,
        enabled,
        interval_minutes,
        ${existingColumns.has('schedule_mode') ? "COALESCE(schedule_mode, 'interval')" : "'interval'"},
        ${existingColumns.has('cron_expression') ? 'cron_expression' : 'NULL'},
        ${existingColumns.has('timezone') ? 'timezone' : 'NULL'},
        agent_slug,
        prompt,
        model,
        skill_metadata,
        created_at,
        updated_at,
        last_run_at,
        next_run_at
      FROM schedule_jobs
    `)

    db.run('DROP TABLE schedule_jobs')
    db.run('ALTER TABLE schedule_jobs_new RENAME TO schedule_jobs')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_repo ON schedule_jobs(repo_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_next_run ON schedule_jobs(enabled, next_run_at)')
  },

  down(db) {
    db.run(`
      CREATE TABLE schedule_jobs_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
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

    db.run(`
      INSERT INTO schedule_jobs_old (
        id, repo_id, name, description, enabled, interval_minutes, agent_slug, prompt, model, skill_metadata,
        created_at, updated_at, last_run_at, next_run_at
      )
      SELECT
        id,
        repo_id,
        name,
        description,
        enabled,
        COALESCE(interval_minutes, 60),
        agent_slug,
        prompt,
        model,
        skill_metadata,
        created_at,
        updated_at,
        last_run_at,
        next_run_at
      FROM schedule_jobs
    `)

    db.run('DROP TABLE schedule_jobs')
    db.run('ALTER TABLE schedule_jobs_old RENAME TO schedule_jobs')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_repo ON schedule_jobs(repo_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_next_run ON schedule_jobs(enabled, next_run_at)')
  },
}

export default migration
