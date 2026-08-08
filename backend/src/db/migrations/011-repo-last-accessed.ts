import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const migration: Migration = {
  version: 11,
  name: 'repo-last-accessed',

  up(db) {
    const tableInfo = db.prepare('PRAGMA table_info(repos)').all() as ColumnInfo[]
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