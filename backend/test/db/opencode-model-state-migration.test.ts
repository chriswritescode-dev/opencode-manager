import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

const paths = vi.hoisted(() => ({
  workDir: '',
  modelStateFile: '',
}))

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => ({
  ...(await importOriginal()),
  getOpenCodeModelStatePath: () => paths.modelStateFile,
}))

interface ModelStateRow {
  recent: unknown[]
  favorite: unknown[]
  variant: Record<string, unknown>
}

function migrateToV19(db: Database): void {
  migrate(db, allMigrations.filter(migration => migration.version < 20))
}

function insertRow(db: Database, state: ModelStateRow, updatedAt: number): void {
  db.prepare(
    'INSERT INTO opencode_model_state (user_id, recent, favorite, variant, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('default', JSON.stringify(state.recent), JSON.stringify(state.favorite), JSON.stringify(state.variant), updatedAt)
}

function tableExists(db: Database): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'opencode_model_state'").get() !== undefined
}

describe('020-drop-opencode-model-state', () => {
  beforeEach(async () => {
    paths.workDir = await mkdtemp(path.join(tmpdir(), 'opencode-model-state-migration-'))
    paths.modelStateFile = path.join(paths.workDir, '.opencode', 'state', 'opencode', 'model.json')
  })

  afterEach(async () => {
    await rm(paths.workDir, { recursive: true, force: true })
  })

  it('writes the file from a newer row and drops the table', async () => {
    const db = new Database(':memory:')
    migrateToV19(db)

    const state: ModelStateRow = {
      recent: [{ providerID: 'anthropic', modelID: 'claude' }],
      favorite: [{ providerID: 'openai', modelID: 'gpt-4' }],
      variant: { anthropic: 'thinking' },
    }
    insertRow(db, state, Date.now() + 60_000)

    migrate(db, allMigrations)

    expect(tableExists(db)).toBe(false)
    expect(JSON.parse(await readFile(paths.modelStateFile, 'utf8'))).toEqual(state)
  })

  it('leaves an existing newer file untouched and drops the table', async () => {
    const db = new Database(':memory:')
    migrateToV19(db)

    const existing = JSON.stringify({
      session: { current: 'abc' },
      recent: [{ providerID: 'existing', modelID: 'model' }],
      favorite: [],
      variant: {},
    })
    await mkdir(path.dirname(paths.modelStateFile), { recursive: true })
    await writeFile(paths.modelStateFile, existing)

    const fileStats = await stat(paths.modelStateFile)
    insertRow(db, { recent: [], favorite: [], variant: {} }, Math.floor(fileStats.mtimeMs) - 60_000)

    migrate(db, allMigrations)

    expect(tableExists(db)).toBe(false)
    expect(await readFile(paths.modelStateFile, 'utf8')).toBe(existing)
  })

  it('preserves unknown top-level keys when restoring over an older file', async () => {
    const db = new Database(':memory:')
    migrateToV19(db)

    await mkdir(path.dirname(paths.modelStateFile), { recursive: true })
    await writeFile(paths.modelStateFile, JSON.stringify({ session: { current: 'abc' }, recent: [] }))

    const state: ModelStateRow = {
      recent: [{ providerID: 'anthropic', modelID: 'claude' }],
      favorite: [],
      variant: {},
    }
    insertRow(db, state, Date.now() + 60_000)

    migrate(db, allMigrations)

    const file = JSON.parse(await readFile(paths.modelStateFile, 'utf8')) as { session: unknown }
    expect(file.session).toEqual({ current: 'abc' })
    expect(file).toMatchObject(state)
  })

  it('does not throw and drops the table when the table is absent', async () => {
    const db = new Database(':memory:')
    migrateToV19(db)
    db.run('DROP TABLE IF EXISTS opencode_model_state')

    expect(() => migrate(db, allMigrations)).not.toThrow()
    expect(tableExists(db)).toBe(false)
  })
})
