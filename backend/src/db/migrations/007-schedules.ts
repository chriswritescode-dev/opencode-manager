import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 7,
  name: 'schedules',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        interval_minutes INTEGER,
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

    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_repo ON schedule_jobs(repo_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_next_run ON schedule_jobs(enabled, next_run_at)')

    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_runs (
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

    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_job ON schedule_runs(job_id, started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_repo ON schedule_runs(repo_id, started_at DESC)')
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS schedule_runs')
    db.run('DROP TABLE IF EXISTS schedule_jobs')
  },
}

export default migration
