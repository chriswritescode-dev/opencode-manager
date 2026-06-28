import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  version: 14,
  name: 'repos-add-name',

  up(db) {
    const tableInfo = db.prepare('PRAGMA table_info(repos)').all() as ColumnInfo[]
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
