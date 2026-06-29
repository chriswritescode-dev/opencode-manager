import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
}

const migration: Migration = {
  version: 16,
  name: 'schedule-permission-config',

  up(db) {
    const cols = db.prepare('PRAGMA table_info(schedule_jobs)').all() as ColumnInfo[]
    if (!cols.some((c) => c.name === 'permission_config')) {
      db.run('ALTER TABLE schedule_jobs ADD COLUMN permission_config TEXT')
    }
  },

  down(_db) {
    void _db
    // no-op: SQLite drop-column requires table rebuild; column is nullable so
    // leaving it in place is safe for rollback scenarios.
  },
}

export default migration
