import { Database } from 'bun:sqlite'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getOpenCodeConfigFilePath, getOpenCodeConfigHome } from '@opencode-manager/shared/config/env'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { selectRow, selectTableColumns } from '../../src/db/rows'
import { applyTestEnv, createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

const TableNameRowSchema = z.object({ name: z.string() })

function migrateToV18(db: Database): void {
  migrate(db, allMigrations.filter(migration => (migration.legacy?.version ?? Infinity) < 19))
}

function insertConfig(db: Database, name: string, content: string, isDefault: boolean): void {
  db.prepare('INSERT INTO opencode_configs (user_id, config_name, config_content, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('default', name, content, isDefault ? 1 : 0, Date.now(), Date.now())
}

function tableExists(db: Database, table: string): boolean {
  return selectRow(db, TableNameRowSchema, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table) !== null
}

function archiveDir(): string {
  return path.join(getOpenCodeConfigHome(), 'opencode-configs-archive')
}

describe('019-drop-opencode-configs', () => {
  let workspace: TempWorkspace
  let restoreEnv: () => void

  beforeEach(() => {
    workspace = createTempWorkspace('opencode-config-migration-')
    restoreEnv = applyTestEnv({ HOME: workspace.path, OPENCODE_IMPORT_CONFIG_PATH: undefined })
  })

  afterEach(() => {
    restoreEnv()
    workspace.restore()
  })

  it('archives rows, restores the default file, and drops the table and column', async () => {
    const db = new Database(':memory:')
    migrateToV18(db)

    const defaultContent = JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'default' })
    const namedContent = JSON.stringify({ model: 'team' })
    insertConfig(db, 'default', defaultContent, true)
    insertConfig(db, 'team/main config', namedContent, false)

    migrate(db, allMigrations)

    expect(tableExists(db, 'opencode_configs')).toBe(false)
    expect(selectTableColumns(db, 'repos').map(column => column.name)).not.toContain('opencode_config_name')
    expect(await readFile(path.join(archiveDir(), 'default.json'), 'utf8')).toBe(defaultContent)
    expect(await readFile(path.join(archiveDir(), 'team_main_config.json'), 'utf8')).toBe(namedContent)
    expect(await readFile(getOpenCodeConfigFilePath(), 'utf8')).toBe(defaultContent)
  })

  it('leaves an existing opencode.json byte-identical', async () => {
    const db = new Database(':memory:')
    migrateToV18(db)

    const defaultContent = JSON.stringify({ model: 'default' })
    insertConfig(db, 'default', defaultContent, true)

    const existingContent = '{\n  // keep me\n  "model": "existing"\n}\n'
    await mkdir(path.dirname(getOpenCodeConfigFilePath()), { recursive: true })
    await writeFile(getOpenCodeConfigFilePath(), existingContent)

    migrate(db, allMigrations)

    expect(await readFile(getOpenCodeConfigFilePath(), 'utf8')).toBe(existingContent)
  })

  it('does not create the config file when an import source exists', async () => {
    const db = new Database(':memory:')
    migrateToV18(db)

    const defaultContent = JSON.stringify({ model: 'default' })
    insertConfig(db, 'default', defaultContent, true)

    const importSource = path.join(workspace.path, 'import-source.json')
    await writeFile(importSource, '{}')
    process.env.OPENCODE_IMPORT_CONFIG_PATH = importSource

    migrate(db, allMigrations)

    await expect(readFile(getOpenCodeConfigFilePath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps every profile when sanitized names collide or the archive destination already exists', async () => {
    const db = new Database(':memory:')
    migrateToV18(db)

    const firstContent = JSON.stringify({ model: 'first' })
    const secondContent = JSON.stringify({ model: 'second' })
    const suffixedContent = JSON.stringify({ model: 'suffixed' })
    insertConfig(db, 'team/main config', firstContent, false)
    insertConfig(db, 'team_main_config', secondContent, false)
    insertConfig(db, 'team_main_config-1', suffixedContent, false)

    await mkdir(archiveDir(), { recursive: true })
    const preExistingContent = JSON.stringify({ model: 'pre-existing' })
    await writeFile(path.join(archiveDir(), 'team_main_config.json'), preExistingContent)

    migrate(db, allMigrations)

    expect(await readFile(path.join(archiveDir(), 'team_main_config.json'), 'utf8')).toBe(preExistingContent)
    const archivedContents = await Promise.all(
      (await readdir(archiveDir())).map(file => readFile(path.join(archiveDir(), file), 'utf8')),
    )
    expect(archivedContents).toHaveLength(4)
    expect(new Set(archivedContents).size).toBe(4)
    expect(archivedContents).toContain(firstContent)
    expect(archivedContents).toContain(secondContent)
    expect(archivedContents).toContain(suffixedContent)
  })
})
