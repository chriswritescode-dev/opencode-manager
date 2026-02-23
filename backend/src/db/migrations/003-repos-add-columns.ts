import type { Migration } from '../migration-runner'

interface ColumnInfo {
  name: string
}

const COLUMNS = [
  { name: 'branch', sql: 'ALTER TABLE repos ADD COLUMN branch TEXT' },
  { name: 'default_branch', sql: 'ALTER TABLE repos ADD COLUMN default_branch TEXT' },
  { name: 'clone_status', sql: 'ALTER TABLE repos ADD COLUMN clone_status TEXT NOT NULL DEFAULT "cloning"' },
  { name: 'cloned_at', sql: 'ALTER TABLE repos ADD COLUMN cloned_at INTEGER NOT NULL DEFAULT 0' },
  { name: 'last_pulled', sql: 'ALTER TABLE repos ADD COLUMN last_pulled INTEGER' },
  { name: 'opencode_config_name', sql: 'ALTER TABLE repos ADD COLUMN opencode_config_name TEXT' },
  { name: 'is_worktree', sql: 'ALTER TABLE repos ADD COLUMN is_worktree BOOLEAN DEFAULT FALSE' },
  { name: 'is_local', sql: 'ALTER TABLE repos ADD COLUMN is_local BOOLEAN DEFAULT FALSE' },
]

const migration: Migration = {
  version: 3,
  name: 'repos-add-columns',

  up(db) {
    const tableInfo = db.prepare('PRAGMA table_info(repos)').all() as ColumnInfo[]
    const existing = new Set(tableInfo.map(col => col.name))

    for (const col of COLUMNS) {
      if (!existing.has(col.name)) {
        db.run(col.sql)
      }
    }
  },

  down(db) {
    void db
  },
}

export default migration
