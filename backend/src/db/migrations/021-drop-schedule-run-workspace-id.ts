import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  version: 21,
  name: 'drop-schedule-run-workspace-id',

  up(db) {
    const cols = db.prepare('PRAGMA table_info(schedule_runs)').all() as ColumnInfo[]
    if (cols.some((c) => c.name === 'workspace_id')) {
      db.run('ALTER TABLE schedule_runs DROP COLUMN workspace_id')
    }
  },

  down(_db) {
    void _db
  },
}

export default migration
