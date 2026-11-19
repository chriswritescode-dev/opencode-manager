import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202610161200-change-walkthrough-execution',

  up(db) {
    const columns = selectTableColumns(db, 'change_walkthroughs')
    if (!columns.some((column) => column.name === 'execution_started_at')) {
      db.run('ALTER TABLE change_walkthroughs ADD COLUMN execution_started_at INTEGER')
    }
  },

  down(db) {
    void db
  },
}

export default migration
