import { selectTableColumns } from '../rows'
import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '009-repo-source-path',
  legacy: { version: 9, name: 'repo-source-path' },

  up(db) {
    const tableInfo = selectTableColumns(db, 'repos')
    const existing = new Set(tableInfo.map((column) => column.name))

    if (!existing.has('source_path')) {
      db.run('ALTER TABLE repos ADD COLUMN source_path TEXT')
    }

    db.run('CREATE INDEX IF NOT EXISTS idx_repo_source_path ON repos(source_path)')
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_repo_source_path')
  },
}

export default migration
