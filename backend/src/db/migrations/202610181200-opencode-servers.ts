import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610181200-opencode-servers',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS opencode_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        username TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS opencode_servers')
    db.run("DELETE FROM app_secrets WHERE key LIKE 'opencode_server:%:password'")
  },
}

export default migration
