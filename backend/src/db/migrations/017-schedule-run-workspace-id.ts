import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
}

const migration: Migration = {
  version: 17,
  name: 'schedule-run-workspace-id',

  up(db) {
    const cols = db.prepare('PRAGMA table_info(schedule_runs)').all() as ColumnInfo[]
    if (!cols.some((c) => c.name === 'workspace_id')) {
      db.run('ALTER TABLE schedule_runs ADD COLUMN workspace_id TEXT')
    }
  },

  down(_db) {
    void _db
    // no-op: SQLite drop-column requires table rebuild; column is nullable so
    // leaving it in place is safe for rollback scenarios.
  },
}

export default migration
