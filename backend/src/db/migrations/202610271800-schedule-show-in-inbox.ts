import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  id: '202610271800-schedule-show-in-inbox',

  up(db) {
    const columns = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    if (!columns.some((column) => column.name === 'show_in_inbox')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN show_in_inbox INTEGER NOT NULL DEFAULT 1')
    }
  },

  down(db) {
    db.run('ALTER TABLE schedule_jobs DROP COLUMN show_in_inbox')
  },
}

export default migration
