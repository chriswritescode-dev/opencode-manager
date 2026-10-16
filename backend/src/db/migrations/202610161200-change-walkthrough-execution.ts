import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  id: '202610161200-change-walkthrough-execution',

  up(db) {
    const columns = db.prepare('PRAGMA table_info(change_walkthroughs)').all() as ColumnInfo[]
    if (!columns.some((column) => column.name === 'execution_started_at')) {
      db.run('ALTER TABLE change_walkthroughs ADD COLUMN execution_started_at INTEGER')
    }
  },

  down(db) {
    void db
  },
}

export default migration
