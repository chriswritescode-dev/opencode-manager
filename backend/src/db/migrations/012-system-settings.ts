import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 12,
  name: 'system_settings',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS system_settings')
  },
}

export default migration
