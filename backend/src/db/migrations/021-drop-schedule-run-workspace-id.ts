import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '021-drop-schedule-run-workspace-id',
  legacy: { version: 21, name: 'drop-schedule-run-workspace-id' },

  up(db) {
    const cols = selectTableColumns(db, 'schedule_runs')
    if (cols.some((c) => c.name === 'workspace_id')) {
      db.run('ALTER TABLE schedule_runs DROP COLUMN workspace_id')
    }
  },

  down(_db) {
    void _db
  },
}

export default migration
