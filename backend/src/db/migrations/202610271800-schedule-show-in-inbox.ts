import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610271800-schedule-show-in-inbox',

  up(db) {
    const columns = selectTableColumns(db, 'schedule_jobs')
    if (!columns.some((column) => column.name === 'show_in_inbox')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN show_in_inbox INTEGER NOT NULL DEFAULT 1')
    }
  },

  down(db) {
    db.run('ALTER TABLE schedule_jobs DROP COLUMN show_in_inbox')
  },
}

export default migration
