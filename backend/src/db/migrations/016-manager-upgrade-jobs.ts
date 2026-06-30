import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 16,
  name: 'manager-upgrade-jobs',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS manager_upgrade_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        from_version TEXT,
        to_version TEXT,
        target_image TEXT,
        error TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `)
  },

  down(db) {
    db.run('DROP TABLE IF EXISTS manager_upgrade_jobs')
  },
}

export default migration
