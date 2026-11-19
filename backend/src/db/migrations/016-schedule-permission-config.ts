import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '016-schedule-permission-config',
  legacy: { version: 16, name: 'schedule-permission-config' },

  up(db) {
    const cols = selectTableColumns(db, 'schedule_jobs')
    if (!cols.some((c) => c.name === 'permission_config')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN permission_config TEXT')
    }
  },

  down(_db) {
    void _db
  },
}

export default migration
