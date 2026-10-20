import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
}

const LEGACY_SUFFIX = '_legacy_202610181320'

function createJobsTable(db: { run: (sql: string) => void }, table: string): void {
  db.run(`
    CREATE TABLE ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER REFERENCES repos(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL DEFAULT 'local',
      directory TEXT,
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
      permission_config TEXT,
      mcp_servers TEXT,
      branch TEXT,
      workspace_mode TEXT NOT NULL DEFAULT 'worktree',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER
    )
  `)
}

function createRunsTable(db: { run: (sql: string) => void }, table: string): void {
  db.run(`
    CREATE TABLE ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES schedule_jobs(id) ON DELETE CASCADE,
      repo_id INTEGER REFERENCES repos(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL DEFAULT 'local',
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      viewed_at INTEGER,
      created_at INTEGER NOT NULL,
      session_id TEXT,
      session_title TEXT,
      log_text TEXT,
      response_text TEXT,
      error_text TEXT,
      run_branch TEXT,
      commit_hash TEXT,
      worktree_path TEXT
    )
  `)
}

const migration: Migration = {
  id: '202610181320-remote-schedule-targets',

  up(db) {
    const jobColumns = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    if (jobColumns.length === 0) {
      return
    }

    const runColumns = db.prepare('PRAGMA table_info(schedule_runs)').all() as ColumnInfo[]
    const jobColumnNames = new Set(jobColumns.map((column) => column.name))
    const runColumnNames = new Set(runColumns.map((column) => column.name))
    const jobsNeedRebuild =
      !jobColumnNames.has('server_id') ||
      !jobColumnNames.has('directory') ||
      jobColumns.find((column) => column.name === 'repo_id')?.notnull !== 0
    const runsNeedRebuild =
      !runColumnNames.has('server_id') ||
      runColumns.find((column) => column.name === 'repo_id')?.notnull !== 0

    if (!jobsNeedRebuild && !runsNeedRebuild) {
      return
    }

    const jobsLegacy = `schedule_jobs${LEGACY_SUFFIX}`
    const runsLegacy = `schedule_runs${LEGACY_SUFFIX}`

    db.run(`DROP TABLE IF EXISTS ${runsLegacy}`)
    db.run(`DROP TABLE IF EXISTS ${jobsLegacy}`)

    db.run(`ALTER TABLE schedule_jobs RENAME TO ${jobsLegacy}`)
    db.run(`ALTER TABLE schedule_runs RENAME TO ${runsLegacy}`)

    createJobsTable(db, 'schedule_jobs')
    createRunsTable(db, 'schedule_runs')

    const jobServerColumn = jobColumnNames.has('server_id') ? 'server_id' : "'local'"
    const jobDirectoryColumn = jobColumnNames.has('directory') ? 'directory' : 'NULL'
    const jobOptionalColumns = ['permission_config', 'mcp_servers', 'branch', 'workspace_mode']
      .map((column) => (jobColumnNames.has(column) ? column : 'NULL'))

    db.run(`
      INSERT INTO schedule_jobs (
        id, repo_id, server_id, directory, name, description, enabled, interval_minutes, schedule_mode,
        cron_expression, timezone, agent_slug, prompt, model, skill_metadata, permission_config, mcp_servers,
        branch, workspace_mode, created_at, updated_at, last_run_at, next_run_at
      )
      SELECT
        id, repo_id, ${jobServerColumn}, ${jobDirectoryColumn}, name, description, enabled, interval_minutes,
        COALESCE(schedule_mode, 'interval'), cron_expression, timezone, agent_slug, prompt, model, skill_metadata,
        ${jobOptionalColumns[0]}, ${jobOptionalColumns[1]}, ${jobOptionalColumns[2]},
        COALESCE(${jobOptionalColumns[3]}, 'worktree'), created_at, updated_at, last_run_at, next_run_at
      FROM ${jobsLegacy}
    `)

    const runServerColumn = runColumnNames.has('server_id') ? 'server_id' : "'local'"
    const runOptionalColumns = ['viewed_at', 'run_branch', 'commit_hash', 'worktree_path']
      .map((column) => (runColumnNames.has(column) ? column : 'NULL'))

    db.run(`
      INSERT INTO schedule_runs (
        id, job_id, repo_id, server_id, trigger_source, status, started_at, finished_at, viewed_at,
        created_at, session_id, session_title, log_text, response_text, error_text, run_branch,
        commit_hash, worktree_path
      )
      SELECT
        id, job_id, repo_id, ${runServerColumn}, trigger_source, status, started_at, finished_at,
        ${runOptionalColumns[0]}, created_at, session_id, session_title, log_text, response_text, error_text,
        ${runOptionalColumns[1]}, ${runOptionalColumns[2]}, ${runOptionalColumns[3]}
      FROM ${runsLegacy}
    `)

    db.run(`DROP TABLE ${runsLegacy}`)
    db.run(`DROP TABLE ${jobsLegacy}`)

    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_repo ON schedule_jobs(repo_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_next_run ON schedule_jobs(enabled, next_run_at)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_server ON schedule_jobs(server_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_job ON schedule_runs(job_id, started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_repo ON schedule_runs(repo_id, started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_session ON schedule_runs(session_id, started_at DESC)')
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_schedule_runs_unread
      ON schedule_runs(finished_at DESC)
      WHERE viewed_at IS NULL
    `)
  },

  down(db) {
    db.run('DELETE FROM schedule_runs WHERE repo_id IS NULL')
    db.run('DELETE FROM schedule_jobs WHERE repo_id IS NULL')

    const jobsLegacy = `schedule_jobs${LEGACY_SUFFIX}`
    const runsLegacy = `schedule_runs${LEGACY_SUFFIX}`

    db.run(`DROP TABLE IF EXISTS ${runsLegacy}`)
    db.run(`DROP TABLE IF EXISTS ${jobsLegacy}`)

    db.run(`ALTER TABLE schedule_jobs RENAME TO ${jobsLegacy}`)
    db.run(`ALTER TABLE schedule_runs RENAME TO ${runsLegacy}`)

    db.run(`
      CREATE TABLE schedule_jobs (
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
        permission_config TEXT,
        mcp_servers TEXT,
        branch TEXT,
        workspace_mode TEXT NOT NULL DEFAULT 'worktree',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER
      )
    `)

    db.run(`
      CREATE TABLE schedule_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES schedule_jobs(id) ON DELETE CASCADE,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        trigger_source TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        viewed_at INTEGER,
        created_at INTEGER NOT NULL,
        session_id TEXT,
        session_title TEXT,
        log_text TEXT,
        response_text TEXT,
        error_text TEXT,
        run_branch TEXT,
        commit_hash TEXT,
        worktree_path TEXT
      )
    `)

    db.run(`
      INSERT INTO schedule_jobs (
        id, repo_id, name, description, enabled, interval_minutes, schedule_mode, cron_expression, timezone,
        agent_slug, prompt, model, skill_metadata, permission_config, mcp_servers, branch, workspace_mode,
        created_at, updated_at, last_run_at, next_run_at
      )
      SELECT
        id, repo_id, name, description, enabled, interval_minutes, schedule_mode, cron_expression, timezone,
        agent_slug, prompt, model, skill_metadata, permission_config, mcp_servers, branch, workspace_mode,
        created_at, updated_at, last_run_at, next_run_at
      FROM ${jobsLegacy}
    `)

    db.run(`
      INSERT INTO schedule_runs (
        id, job_id, repo_id, trigger_source, status, started_at, finished_at, viewed_at, created_at,
        session_id, session_title, log_text, response_text, error_text, run_branch, commit_hash, worktree_path
      )
      SELECT
        id, job_id, repo_id, trigger_source, status, started_at, finished_at, viewed_at, created_at,
        session_id, session_title, log_text, response_text, error_text, run_branch, commit_hash, worktree_path
      FROM ${runsLegacy}
    `)

    db.run(`DROP TABLE ${runsLegacy}`)
    db.run(`DROP TABLE ${jobsLegacy}`)

    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_repo ON schedule_jobs(repo_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_jobs_next_run ON schedule_jobs(enabled, next_run_at)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_job ON schedule_runs(job_id, started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_repo ON schedule_runs(repo_id, started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_schedule_runs_session ON schedule_runs(session_id, started_at DESC)')
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_schedule_runs_unread
      ON schedule_runs(finished_at DESC)
      WHERE viewed_at IS NULL
    `)
  },
}

export default migration
