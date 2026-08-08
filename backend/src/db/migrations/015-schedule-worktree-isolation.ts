import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
}

const migration: Migration = {
  version: 15,
  name: 'schedule-worktree-isolation',

  up(db) {
    const jobColumns = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    const jobColumnNames = new Set(jobColumns.map((c) => c.name))

    if (!jobColumnNames.has('branch')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN branch TEXT')
    }

    const runColumns = db.prepare('PRAGMA table_info(schedule_runs)').all() as ColumnInfo[]
    const runColumnNames = new Set(runColumns.map((c) => c.name))

    if (!runColumnNames.has('run_branch')) {
      db.run('ALTER TABLE schedule_runs ADD COLUMN run_branch TEXT')
    }
    if (!runColumnNames.has('commit_hash')) {
      db.run('ALTER TABLE schedule_runs ADD COLUMN commit_hash TEXT')
    }
    if (!runColumnNames.has('worktree_path')) {
      db.run('ALTER TABLE schedule_runs ADD COLUMN worktree_path TEXT')
    }
  },

  down(db) {
    // Rebuild schedule_jobs without branch
    const jobColumns = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    const hasBranch = jobColumns.some((c) => c.name === 'branch')

    if (hasBranch) {
      db.run(`
        CREATE TABLE schedule_jobs_old (
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
        INSERT INTO schedule_jobs_old (
          id, repo_id, name, description, enabled, interval_minutes, schedule_mode,
          cron_expression, timezone, agent_slug, prompt, model, skill_metadata,
          created_at, updated_at, last_run_at, next_run_at
        )
        SELECT
          id, repo_id, name, description, enabled, interval_minutes, schedule_mode,
          cron_expression, timezone, agent_slug, prompt, model, skill_metadata,
          created_at, updated_at, last_run_at, next_run_at
        FROM schedule_jobs
      `)

      db.run('DROP TABLE schedule_jobs')
      db.run('ALTER TABLE schedule_jobs_old RENAME TO schedule_jobs')
      db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_repo ON schedule_jobs(repo_id)')
      db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_next_run ON schedule_jobs(enabled, next_run_at)')
    }

    // Rebuild schedule_runs without run_branch, commit_hash, worktree_path
    const runColumns = db.prepare('PRAGMA table_info(schedule_runs)').all() as ColumnInfo[]
    const hasRunBranch = runColumns.some((c) => c.name === 'run_branch')
    const hasCommitHash = runColumns.some((c) => c.name === 'commit_hash')
    const hasWorktreePath = runColumns.some((c) => c.name === 'worktree_path')

    if (hasRunBranch || hasCommitHash || hasWorktreePath) {
      db.run(`
        CREATE TABLE schedule_runs_old (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL REFERENCES schedule_jobs(id) ON DELETE CASCADE,
          repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
          trigger_source TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          created_at INTEGER NOT NULL,
          session_id TEXT,
          session_title TEXT,
          log_text TEXT,
          response_text TEXT,
          error_text TEXT
        )
      `)

      db.run(`
        INSERT INTO schedule_runs_old (
          id, job_id, repo_id, trigger_source, status, started_at, finished_at,
          created_at, session_id, session_title, log_text, response_text, error_text
        )
        SELECT
          id, job_id, repo_id, trigger_source, status, started_at, finished_at,
          created_at, session_id, session_title, log_text, response_text, error_text
        FROM schedule_runs
      `)

      db.run('DROP TABLE schedule_runs')
      db.run('ALTER TABLE schedule_runs_old RENAME TO schedule_runs')
      db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_job ON schedule_runs(job_id, started_at DESC)')
      db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_repo ON schedule_runs(repo_id, started_at DESC)')
    }
  },
}

export default migration
