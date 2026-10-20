import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
}

const REBUILT_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER,
  server_id TEXT NOT NULL DEFAULT 'local',
  directory TEXT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  isolated INTEGER NOT NULL,
  base_ref TEXT,
  created_at INTEGER NOT NULL
`

function needsRebuild(columns: ColumnInfo[]): boolean {
  if (columns.length === 0) return false

  const byName = new Map(columns.map((column) => [column.name, column]))
  const repoId = byName.get('repo_id')
  if (!repoId || repoId.notnull === 1) return true
  return !byName.has('server_id') || !byName.has('directory')
}

const migration: Migration = {
  id: '202610181310-multi-run-targets',

  up(db) {
    const columns = db.prepare('PRAGMA table_info(multi_runs)').all() as ColumnInfo[]
    if (!needsRebuild(columns)) return

    const names = new Set(columns.map((column) => column.name))
    const serverId = names.has('server_id') ? 'server_id' : "'local'"
    const directory = names.has('directory') ? 'directory' : 'NULL'

    db.run('DROP TABLE IF EXISTS multi_runs_targets')
    db.run(`CREATE TABLE multi_runs_targets (${REBUILT_COLUMNS})`)
    db.run(`
      INSERT INTO multi_runs_targets (id, repo_id, server_id, directory, name, prompt, isolated, base_ref, created_at)
      SELECT id, repo_id, ${serverId}, ${directory}, name, prompt, isolated, base_ref, created_at
      FROM multi_runs
    `)
    db.run('DROP TABLE multi_runs')
    db.run('ALTER TABLE multi_runs_targets RENAME TO multi_runs')
    db.run('CREATE INDEX IF NOT EXISTS idx_multi_runs_repo ON multi_runs(repo_id, created_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_multi_runs_server ON multi_runs(server_id, directory, created_at DESC)')
  },

  down(db) {
    const columns = db.prepare('PRAGMA table_info(multi_runs)').all() as ColumnInfo[]
    if (columns.length === 0) return

    const names = new Set(columns.map((column) => column.name))
    if (!names.has('server_id') && !names.has('directory')) return

    db.run('DROP TABLE IF EXISTS multi_runs_repo_only')
    db.run(`
      CREATE TABLE multi_runs_repo_only (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        isolated INTEGER NOT NULL,
        base_ref TEXT,
        created_at INTEGER NOT NULL
      )
    `)
    db.run(`
      INSERT INTO multi_runs_repo_only (id, repo_id, name, prompt, isolated, base_ref, created_at)
      SELECT id, repo_id, name, prompt, isolated, base_ref, created_at
      FROM multi_runs
      WHERE repo_id IS NOT NULL
    `)
    db.run('DROP TABLE multi_runs')
    db.run('ALTER TABLE multi_runs_repo_only RENAME TO multi_runs')
    db.run('CREATE INDEX IF NOT EXISTS idx_multi_runs_repo ON multi_runs(repo_id, created_at DESC)')
  },
}

export default migration
