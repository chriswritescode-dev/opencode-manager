import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610181400-secrets',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('secret','variable')),
        repo_id INTEGER REFERENCES repos(id) ON DELETE CASCADE,
        environment TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_scope ON secrets(kind, COALESCE(repo_id, 0), environment, name)')
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS secrets')
  },
}

export default migration
