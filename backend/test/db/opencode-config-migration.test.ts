import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

const paths = vi.hoisted(() => ({
  workDir: '',
  configHome: '',
  configFile: '',
}))

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => ({
  ...(await importOriginal()),
  getOpenCodeConfigHome: () => paths.configHome,
  getOpenCodeConfigFilePath: () => paths.configFile,
}))

const originalHome = process.env.HOME
const originalImportConfigPath = process.env.OPENCODE_IMPORT_CONFIG_PATH

function migrateToV18(db: Database): void {
  migrate(db, allMigrations.filter(migration => migration.version < 19))
}

function insertConfig(db: Database, name: string, content: string, isDefault: boolean): void {
  db.prepare('INSERT INTO opencode_configs (user_id, config_name, config_content, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('default', name, content, isDefault ? 1 : 0, Date.now(), Date.now())
}

describe('019-drop-opencode-configs', () => {
  beforeEach(async () => {
    paths.workDir = await mkdtemp(path.join(tmpdir(), 'opencode-config-migration-'))
    paths.configHome = path.join(paths.workDir, '.config')
    paths.configFile = path.join(paths.configHome, 'opencode', 'opencode.json')
    process.env.HOME = paths.workDir
    delete process.env.OPENCODE_IMPORT_CONFIG_PATH
  })

  afterEach(async () => {
    await rm(paths.workDir, { recursive: true, force: true })
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalImportConfigPath === undefined) {
      delete process.env.OPENCODE_IMPORT_CONFIG_PATH
    } else {
      process.env.OPENCODE_IMPORT_CONFIG_PATH = originalImportConfigPath
    }
  })

  it('archives rows, restores the default file, and drops the table and column', async () => {
    const db = new Database(':memory:')
    migrateToV18(db)

    const defaultContent = JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'default' })
    const namedContent = JSON.stringify({ model: 'team' })
    insertConfig(db, 'default', defaultContent, true)
    insertConfig(db, 'team/main config', namedContent, false)

    migrate(db, allMigrations)

    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'opencode_configs'").get()).toBeUndefined()
    const columns = (db.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).not.toContain('opencode_config_name')
    expect(await readFile(path.join(paths.configHome, 'opencode-configs-archive', 'default.json'), 'utf8')).toBe(defaultContent)
    expect(await readFile(path.join(paths.configHome, 'opencode-configs-archive', 'team_main_config.json'), 'utf8')).toBe(namedContent)
    expect(await readFile(paths.configFile, 'utf8')).toBe(defaultContent)
  })

  it('leaves an existing opencode.json byte-identical', async () => {
    const db = new Database(':memory:')
    migrateToV18(db)

    const defaultContent = JSON.stringify({ model: 'default' })
    insertConfig(db, 'default', defaultContent, true)

    const existingContent = '{\n  // keep me\n  "model": "existing"\n}\n'
    await mkdir(path.dirname(paths.configFile), { recursive: true })
    await writeFile(paths.configFile, existingContent)

    migrate(db, allMigrations)

    expect(await readFile(paths.configFile, 'utf8')).toBe(existingContent)
  })

  it('does not create the config file when an import source exists', async () => {
    const db = new Database(':memory:')
    migrateToV18(db)

    const defaultContent = JSON.stringify({ model: 'default' })
    insertConfig(db, 'default', defaultContent, true)

    const importSource = path.join(paths.workDir, 'import-source.json')
    await writeFile(importSource, '{}')
    process.env.OPENCODE_IMPORT_CONFIG_PATH = importSource

    migrate(db, allMigrations)

    await expect(readFile(paths.configFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['opencode.jsonc', 'config.json'])('does not restore a duplicate JSON config when %s exists', async (name) => {
    const db = new Database(':memory:')
    migrateToV18(db)
    insertConfig(db, 'default', '{"model":"old-default"}', true)
    const sourcePath = path.join(path.dirname(paths.configFile), name)
    const rawContent = '{\n  // original\n  "model": "existing"\n}\n'
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, rawContent)

    migrate(db, allMigrations)

    expect(await readFile(sourcePath, 'utf8')).toBe(rawContent)
    await expect(readFile(paths.configFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    db.close()
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

    const archiveDir = path.join(paths.configHome, 'opencode-configs-archive')
    await mkdir(archiveDir, { recursive: true })
    const preExistingContent = JSON.stringify({ model: 'pre-existing' })
    await writeFile(path.join(archiveDir, 'team_main_config.json'), preExistingContent)

    migrate(db, allMigrations)

    expect(await readFile(path.join(archiveDir, 'team_main_config.json'), 'utf8')).toBe(preExistingContent)
    const archivedContents = await Promise.all(
      (await readdir(archiveDir)).map(file => readFile(path.join(archiveDir, file), 'utf8'))
    )
    expect(archivedContents).toHaveLength(4)
    expect(new Set(archivedContents).size).toBe(4)
    expect(archivedContents).toContain(firstContent)
    expect(archivedContents).toContain(secondContent)
    expect(archivedContents).toContain(suffixedContent)
  })
})
