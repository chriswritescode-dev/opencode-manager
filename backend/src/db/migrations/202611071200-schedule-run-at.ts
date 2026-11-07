import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  id: '202611071200-schedule-run-at',

  up(db) {
    const columns = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    if (!columns.some((column) => column.name === 'run_at')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN run_at TEXT')
    }
  },

  down(db) {
    db.run('ALTER TABLE schedule_jobs DROP COLUMN run_at')
  },
}

export default migration
