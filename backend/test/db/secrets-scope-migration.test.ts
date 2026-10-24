import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { secretsGlobalScopeIndexMigration } from '../../src/db/migrations/202610181410-secrets-global-scope-index'
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

    secretsGlobalScopeIndexMigration.down(db)

    expect(scopeIndexSql(db)).toContain('COALESCE(repo_id, 0)')
  })

  it('collapses merged global and Assistant scopes to the newest row on rollback', () => {
    migrate(db, allMigrations)
    service.set('secret', null, null, 'TOKEN', 'global-token')
    service.set('secret', ASSISTANT_REPO_ID, null, 'TOKEN', 'assistant-token')
    db.prepare('UPDATE secrets SET updated_at = ? WHERE repo_id IS NULL').run(1_000)
    db.prepare('UPDATE secrets SET updated_at = ? WHERE repo_id = ?').run(2_000, ASSISTANT_REPO_ID)

    expect(() => secretsGlobalScopeIndexMigration.down(db)).not.toThrow()

    expect(scopeIndexSql(db)).toContain('COALESCE(repo_id, 0)')
    expect(
      db.prepare('SELECT repo_id, name, updated_at FROM secrets').all(),
    ).toEqual([{ repo_id: ASSISTANT_REPO_ID, name: 'TOKEN', updated_at: 2_000 }])
    expect(service.resolveValues(ASSISTANT_REPO_ID, null).secrets.TOKEN).toBe('assistant-token')
  })
})
