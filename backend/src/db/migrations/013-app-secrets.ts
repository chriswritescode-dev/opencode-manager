import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 13,
  name: 'app-secrets',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS app_secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS app_secrets')
  },
}

export default migration
