import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610061345-schedule-workspace-mode',

  up(db) {
    const columns = selectTableColumns(db, 'schedule_jobs')
    if (!columns.some((column) => column.name === 'workspace_mode')) {
      db.run("ALTER TABLE schedule_jobs ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'worktree'")
    }
  },

  down(db) {
    db.run('ALTER TABLE schedule_jobs DROP COLUMN workspace_mode')
  },
}

export default migration
