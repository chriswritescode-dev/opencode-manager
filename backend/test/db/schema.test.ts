import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { initializeDatabase } from '../../src/db/schema'
import { getRepoById } from '../../src/db/queries'
import { selectRow, selectRows } from '../../src/db/rows'

const AppliedMigrationRowSchema = z.object({ name: z.string() })
const PreferencesRowSchema = z.object({ preferences: z.string() })

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

    const migrations = selectRows(db, AppliedMigrationRowSchema, 'SELECT id AS name FROM applied_migrations')
    expect(migrations.map((migration) => migration.name)).toContain('001-base-schema')
    expect(migrations.map((migration) => migration.name)).toContain('019-drop-opencode-configs')

    const preferences = selectRow(db, PreferencesRowSchema, 'SELECT preferences FROM user_preferences WHERE user_id = ?', 'default')
    expect(preferences?.preferences).toBe('{}')

    expect(getRepoById(db, 0)?.localPath).toBe('assistant')

    db.close()

    const fileContents = await readFile(dbPath, 'utf-8')
    expect(fileContents.length).toBeGreaterThan(0)
  })
})
