import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  id: '202610251900-schedule-sandbox-config',

  up(db) {
    const columns = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    if (!columns.some((column) => column.name === 'sandbox_config')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN sandbox_config TEXT')
    }
  },

  down(db) {
    db.run('ALTER TABLE schedule_jobs DROP COLUMN sandbox_config')
  },
}

export default migration
