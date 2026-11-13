import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '014-repos-add-name',
  legacy: { version: 14, name: 'repos-add-name' },

  up(db) {
    const tableInfo = selectTableColumns(db, 'repos')
    const existing = new Set(tableInfo.map((column) => column.name))

    if (!existing.has('name')) {
      db.run('ALTER TABLE repos ADD COLUMN name TEXT')
    }
  },

  down(db) {
    void db
  },
}

export default migration
