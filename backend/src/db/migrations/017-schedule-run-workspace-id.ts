import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '017-schedule-run-workspace-id',
  legacy: { version: 17, name: 'schedule-run-workspace-id' },

  up(db) {
    const cols = selectTableColumns(db, 'schedule_runs')
    if (!cols.some((c) => c.name === 'workspace_id')) {
      db.run('ALTER TABLE schedule_runs ADD COLUMN workspace_id TEXT')
    }
  },

  down(_db) {
    void _db
  },
}

export default migration
