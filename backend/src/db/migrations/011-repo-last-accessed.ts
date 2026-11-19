import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '011-repo-last-accessed',
  legacy: { version: 11, name: 'repo-last-accessed' },

  up(db) {
    const tableInfo = selectTableColumns(db, 'repos')
    const existing = new Set(tableInfo.map((column) => column.name))

    if (!existing.has('last_accessed_at')) {
      db.run('ALTER TABLE repos ADD COLUMN last_accessed_at INTEGER')
    }
  },

  down(db) {
    void db
  },
}

export default migration