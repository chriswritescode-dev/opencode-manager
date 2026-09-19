import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 12,
  name: 'opencode-model-state',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS opencode_model_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
        recent TEXT NOT NULL DEFAULT '[]',
        favorite TEXT NOT NULL DEFAULT '[]',
        variant TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_opencode_model_state_user ON opencode_model_state(user_id)')
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS opencode_model_state')
  },
}

export default migration
