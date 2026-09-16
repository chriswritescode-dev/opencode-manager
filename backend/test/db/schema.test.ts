import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeDatabase } from '../../src/db/schema'
import { getRepoById } from '../../src/db/queries'

describe('initializeDatabase', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'ocm-db-'))
    dbPath = path.join(tempDir, 'nested', 'opencode.db')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates the database file, applies migrations, and seeds defaults', async () => {
    const db = initializeDatabase(dbPath)

    const migrations = db.prepare('SELECT name FROM schema_migrations ORDER BY version ASC').all() as Array<{ name: string }>
    expect(migrations.map(migration => migration.name)).toContain('base-schema')
    expect(migrations.map(migration => migration.name)).toContain('drop-opencode-configs')

    const preferences = db.prepare('SELECT preferences FROM user_preferences WHERE user_id = ?').get('default') as { preferences: string }
    expect(preferences.preferences).toBe('{}')

    expect(getRepoById(db, 0)?.localPath).toBe('assistant')

    const modelStateTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'opencode_model_state'").get()
    expect(modelStateTable).toBeDefined()

    db.close()

    const fileContents = await readFile(dbPath, 'utf-8')
    expect(fileContents.length).toBeGreaterThan(0)
  })
})
