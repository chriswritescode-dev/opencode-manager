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

function collapseLegacyScopeDuplicates(db: Database): void {
  db.run(`
    DELETE FROM secrets
    WHERE (repo_id IS NULL OR repo_id = ${LEGACY_GLOBAL_SCOPE_ID})
      AND EXISTS (
        SELECT 1
        FROM secrets AS newer
        WHERE (newer.repo_id IS NULL OR newer.repo_id = ${LEGACY_GLOBAL_SCOPE_ID})
          AND newer.kind = secrets.kind
          AND newer.environment = secrets.environment
          AND newer.name = secrets.name
          AND (
            newer.updated_at > secrets.updated_at
            OR (newer.updated_at = secrets.updated_at AND newer.id > secrets.id)
          )
      )
  `)
}

export const secretsGlobalScopeIndexMigration: Migration = {
  id: '202610181410-secrets-global-scope-index',
  up(db) {
    rebuildScopeIndex(db, GLOBAL_SECRETS_SCOPE_ID)
  },
  down(db) {
    db.run('BEGIN TRANSACTION')
    try {
      collapseLegacyScopeDuplicates(db)
      rebuildScopeIndex(db, LEGACY_GLOBAL_SCOPE_ID)
      db.run('COMMIT')
    } catch (error) {
      db.run('ROLLBACK')
      throw error
    }
  },
}
