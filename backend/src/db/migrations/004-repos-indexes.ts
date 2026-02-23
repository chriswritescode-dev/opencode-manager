import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 4,
  name: 'repos-indexes',

  up(db) {
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_url_branch
      ON repos(repo_url, branch)
      WHERE branch IS NOT NULL
    `)
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_local_path ON repos(local_path)')
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS idx_repo_url_branch')
    db.run('DROP INDEX IF EXISTS idx_local_path')
  },
}

export default migration
