import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610061701-change-walkthroughs',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS change_walkthroughs (
        session_id TEXT PRIMARY KEY,
        diff_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
  },
  down(db) {
    db.run('DROP TABLE IF EXISTS change_walkthroughs')
  },
}

export default migration
