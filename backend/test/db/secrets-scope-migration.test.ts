import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import scopeIndexMigration from '../../src/db/migrations/202610181410-secrets-global-scope-index'
import { SecretsService } from '../../src/services/secrets'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'

const SECRETS_TABLE_MIGRATION_ID = '202610181400-secrets'
const SCOPE_INDEX_MIGRATION_ID = '202610181410-secrets-global-scope-index'

function scopeIndexSql(db: Database): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_secrets_scope'")
    .get() as { sql: string } | null

  return row?.sql ?? ''
}

function migrateThroughSecretsTable(db: Database): void {
  const index = allMigrations.findIndex((migration) => migration.id === SECRETS_TABLE_MIGRATION_ID)
  migrate(db, allMigrations.slice(0, index + 1))
}

describe('secrets global scope index migration', () => {
  let db: Database
  let service: SecretsService

  beforeEach(() => {
    db = new Database(':memory:')
    service = new SecretsService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('rebuilds the scope index so global and Assistant repository entries coexist', () => {
    migrateThroughSecretsTable(db)
    expect(scopeIndexSql(db)).toContain('COALESCE(repo_id, 0)')
    expect(() => service.set('variable', null, null, 'LOG_LEVEL', 'global')).toThrow(/ON CONFLICT/)

    migrate(db, allMigrations)

    expect(scopeIndexSql(db)).toContain('COALESCE(repo_id, -1)')

    service.set('variable', null, null, 'LOG_LEVEL', 'global')
    service.set('variable', ASSISTANT_REPO_ID, null, 'LOG_LEVEL', 'assistant')
    service.set('variable', null, null, 'LOG_LEVEL', 'global-updated')
    service.set('variable', ASSISTANT_REPO_ID, null, 'LOG_LEVEL', 'assistant-updated')

    expect(service.list('variable', null)).toEqual([
      expect.objectContaining({ name: 'LOG_LEVEL', value: 'global-updated' }),
    ])
    expect(service.list('variable', ASSISTANT_REPO_ID)).toEqual([
      expect.objectContaining({ name: 'LOG_LEVEL', value: 'assistant-updated' }),
    ])
  })

  it('applies the scope index migration on a fresh database', () => {
    migrate(db, allMigrations)

    const applied = db.prepare('SELECT id FROM applied_migrations WHERE id = ?').get(SCOPE_INDEX_MIGRATION_ID)
    expect(applied).toBeTruthy()
    expect(scopeIndexSql(db)).toContain('COALESCE(repo_id, -1)')
  })

  it('restores the legacy index expression on rollback', () => {
    migrate(db, allMigrations)

    scopeIndexMigration.down(db)

    expect(scopeIndexSql(db)).toContain('COALESCE(repo_id, 0)')
  })
})
