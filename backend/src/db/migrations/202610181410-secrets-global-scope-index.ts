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

/**
 * Deletes the rows the legacy scope key cannot hold.
 *
 * The legacy index merged global rows (`repo_id IS NULL`) with the Assistant repository's scope
 * (`repo_id = 0`), and the old upsert let the last write win, so the newest row of each merged
 * group is the state legacy code would hold. Ordering by `updated_at`, then `id`, keeps that row
 * and deletes the rest, which lets the legacy unique index be recreated.
 */
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
