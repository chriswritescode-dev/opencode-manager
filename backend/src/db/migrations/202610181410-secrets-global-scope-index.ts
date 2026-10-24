import type { Database } from 'bun:sqlite'
import type { Migration } from '../migration-runner'
import { GLOBAL_SECRETS_SCOPE_ID } from '../secrets-scope'

const LEGACY_GLOBAL_SCOPE_ID = 0

function rebuildScopeIndex(db: Database, globalScopeId: number): void {
  db.run('DROP INDEX IF EXISTS idx_secrets_scope')
  db.run(
    `CREATE UNIQUE INDEX idx_secrets_scope ON secrets(kind, COALESCE(repo_id, ${globalScopeId}), environment, name)`,
  )
}

const migration: Migration = {
  id: '202610181410-secrets-global-scope-index',
  up(db) {
    rebuildScopeIndex(db, GLOBAL_SECRETS_SCOPE_ID)
  },
  down(db) {
    rebuildScopeIndex(db, LEGACY_GLOBAL_SCOPE_ID)
  },
}

export default migration
