import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { getConfigPath, getWorkspacePath } from '@opencode-manager/shared/config/env'
import type { SettingsService } from '../../src/services/settings'
import {
  readOpenCodeConfigFile,
  serializeOpenCodeConfigSnapshot,
} from '../../src/services/opencode-config-file'
import {
  getImportedSessionDirectories,
  getOpenCodeImportStatus,
  importOpenCodeStateDirectory,
  shouldImportOpenCodeStateEntry,
  syncOpenCodeImport,
} from '../../src/services/opencode-import'
import { applyTestEnv, createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

function createStateDatabase(dbPath: string, directories: string[] = []): void {
  const db = new Database(dbPath)
  try {
    db.exec('CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY NOT NULL, directory TEXT)')
    const insert = db.query('INSERT INTO session (id, directory) VALUES (?, ?)')
    directories.forEach((directory, index) => {
      insert.run(`ses_${index}`, directory)
    })
  } finally {
    db.close()
  }
}

describe('opencode-import service', () => {
  let workspace: TempWorkspace
  let restoreEnv: () => void
  let home: string
  let hostConfigDir: string
  let workspaceStateDir: string

  async function writeHostConfig(name: string, content: string): Promise<string> {
    const target = path.join(hostConfigDir, name)
    await mkdir(hostConfigDir, { recursive: true })
    await writeFile(target, content, 'utf8')
    return target
  }

  async function createHostState(directories: string[] = []): Promise<string> {
    const stateDir = path.join(home, 'host-state')
    await mkdir(stateDir, { recursive: true })
    createStateDatabase(path.join(stateDir, 'opencode.db'), directories)
    return stateDir
  }

  function workspaceConfigPath(name: string): string {
    return path.join(getConfigPath(), name)
  }

  async function stagedDirectories(parent: string): Promise<string[]> {
    return (await readdir(parent)).filter((name) => name.startsWith('opencode-import-'))
  }

  beforeEach(() => {
    workspace = createTempWorkspace('opencode-import-')
    home = mkdtempSync(path.join(os.tmpdir(), 'opencode-import-home-'))
    restoreEnv = applyTestEnv({
      HOME: home,
      OPENCODE_IMPORT_CONFIG_PATH: undefined,
      OPENCODE_IMPORT_STATE_PATH: undefined,
    })
    hostConfigDir = path.join(home, '.config', 'opencode')
    workspaceStateDir = path.join(getWorkspacePath(), '.opencode', 'state', 'opencode')
  })

  afterEach(() => {
    restoreEnv()
    rmSync(home, { recursive: true, force: true })
    workspace.restore()
  })

  it('imports every discovered global source without flattening or renaming JSONC', async () => {
    const rawJson = '{"model":"test/lower"}'
    const rawJsonc = '{\n// keep\n"model":"test/higher"\n}'
    const jsonPath = await writeHostConfig('opencode.json', rawJson)
    const jsoncPath = await writeHostConfig('opencode.jsonc', rawJsonc)

    const result = await syncOpenCodeImport({})

    expect(result.configSourcePaths).toEqual([jsonPath, jsoncPath])
    expect(result.configSourcePath).toBe(jsoncPath)
    await expect(readFile(workspaceConfigPath('opencode.json'), 'utf8')).resolves.toBe(rawJson)
    await expect(readFile(workspaceConfigPath('opencode.jsonc'), 'utf8')).resolves.toBe(rawJsonc)
  })

  it('preserves an explicitly imported JSONC filename', async () => {
    const submitted = '{\n// imported\n"model":"test/higher"\n}'
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.jsonc', submitted)

    await syncOpenCodeImport({})

    await expect(readFile(workspaceConfigPath('opencode.jsonc'), 'utf8')).resolves.toBe(submitted)
  })

  it('mirrors a host config.json alongside the native sources', async () => {
    const rawJson = '{"model":"test/lower"}'
    const rawLegacy = '{"theme":"dark"}'
    const jsonPath = await writeHostConfig('opencode.json', rawJson)
    const legacyPath = await writeHostConfig('config.json', rawLegacy)

    const result = await syncOpenCodeImport({})

    expect(result.configSourcePaths).toEqual([jsonPath, legacyPath])
    expect(result.configSourcePath).toBe(legacyPath)
    const mirrored = await readFile(workspaceConfigPath('opencode.json'), 'utf8')
    expect(mirrored).toContain('"model": "test/lower"')
    expect(mirrored).toContain('"theme": "dark"')
    await expect(readFile(workspaceConfigPath('config.json'), 'utf8')).rejects.toThrow()
  })

  it('detects importable host config and state paths with opencode.db', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"model":"test/lower"}')
    process.env.OPENCODE_IMPORT_STATE_PATH = await createHostState()
    await mkdir(workspaceStateDir, { recursive: true })
    createStateDatabase(path.join(workspaceStateDir, 'opencode.db'))

    const status = await getOpenCodeImportStatus()

    expect(status).toEqual({
      configSourcePath: process.env.OPENCODE_IMPORT_CONFIG_PATH,
      configSourcePaths: [process.env.OPENCODE_IMPORT_CONFIG_PATH],
      stateSourcePath: process.env.OPENCODE_IMPORT_STATE_PATH,
      workspaceConfigPath: workspaceConfigPath('opencode.jsonc'),
      workspaceConfigPathsToRemove: [],
      workspaceStatePath: workspaceStateDir,
      workspaceStateExists: true,
    })
  })

  it('reports workspace config sources absent from the host as pending removals', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"model":"test/lower"}')
    await mkdir(getConfigPath(), { recursive: true })
    await writeFile(workspaceConfigPath('opencode.jsonc'), '{"theme":"dark"}', 'utf8')

    const status = await getOpenCodeImportStatus()

    expect(status.workspaceConfigPathsToRemove).toEqual([workspaceConfigPath('opencode.jsonc')])
  })

  it('reports no pending removals when workspace and host share a config basename', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"model":"test/lower"}')
    await mkdir(getConfigPath(), { recursive: true })
    await writeFile(workspaceConfigPath('opencode.json'), '{"theme":"dark"}', 'utf8')

    const status = await getOpenCodeImportStatus()

    expect(status.workspaceConfigPathsToRemove).toEqual([])
  })

  it('reports no pending removals when no host config source is detected', async () => {
    await mkdir(getConfigPath(), { recursive: true })
    await writeFile(workspaceConfigPath('opencode.jsonc'), '{"theme":"dark"}', 'utf8')

    const status = await getOpenCodeImportStatus()

    expect(status.configSourcePaths).toEqual([])
    expect(status.workspaceConfigPathsToRemove).toEqual([])
  })

  it('imports host config and state into the workspace', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"$schema":"https://opencode.ai/config.json"}')
    process.env.OPENCODE_IMPORT_STATE_PATH = await createHostState()

    const result = await syncOpenCodeImport({ overwriteState: true })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(true)
    expect(result.workspaceStateExists).toBe(true)
    await expect(readFile(workspaceConfigPath('opencode.json'), 'utf8'))
      .resolves.toBe('{"$schema":"https://opencode.ai/config.json"}')
    await expect(readFile(path.join(workspaceStateDir, 'opencode.db'))).resolves.toBeInstanceOf(Buffer)
  })

  it('captures the previous on-disk config as last known good before importing over it', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"$schema":"https://opencode.ai/config.json"}')
    await mkdir(getConfigPath(), { recursive: true })
    await writeFile(workspaceConfigPath('opencode.jsonc'), '{"theme":"previous"}', 'utf8')
    const previous = await readOpenCodeConfigFile()
    if (previous === null) throw new Error('expected a previous workspace config to exist')
    const saveLastKnownGoodConfig = vi.fn<SettingsService['saveLastKnownGoodConfig']>()
    const settingsService = { saveLastKnownGoodConfig }

    await syncOpenCodeImport({ overwriteState: true, settingsService })

    expect(saveLastKnownGoodConfig).toHaveBeenCalledWith(serializeOpenCodeConfigSnapshot(previous))
    await expect(readFile(workspaceConfigPath('opencode.json'), 'utf8'))
      .resolves.toBe('{"$schema":"https://opencode.ai/config.json"}')
  })

  it('does not capture last known good when no previous config file exists', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"$schema":"https://opencode.ai/config.json"}')
    const saveLastKnownGoodConfig = vi.fn<SettingsService['saveLastKnownGoodConfig']>()
    const settingsService = { saveLastKnownGoodConfig }

    await syncOpenCodeImport({ overwriteState: true, settingsService })

    expect(saveLastKnownGoodConfig).not.toHaveBeenCalled()
    await expect(readFile(workspaceConfigPath('opencode.json'), 'utf8'))
      .resolves.toBe('{"$schema":"https://opencode.ai/config.json"}')
  })

  it('does not report state imported when source db is missing', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"$schema":"https://opencode.ai/config.json"}')
    const stateDir = path.join(home, 'host-state')
    await mkdir(stateDir, { recursive: true })
    process.env.OPENCODE_IMPORT_STATE_PATH = stateDir

    const result = await syncOpenCodeImport({ overwriteState: true })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(false)
    await expect(readdir(path.join(getWorkspacePath(), '.opencode', 'state'))).rejects.toThrow()
  })

  it('reports the resolved import config candidate as the config source path', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = process.execPath

    const status = await getOpenCodeImportStatus()

    expect(status.configSourcePath).toBe(process.execPath)
  })

  it('rejects invalid importable config content with the existing error', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"model": 123}')

    await expect(syncOpenCodeImport({ overwriteState: true })).rejects.toThrow('Importable OpenCode config is invalid')
    await expect(readFile(workspaceConfigPath('opencode.jsonc'), 'utf8')).rejects.toThrow()
  })

  it('imports state without rewriting the config when importConfig is false', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"model":"test/lower"}')
    process.env.OPENCODE_IMPORT_STATE_PATH = await createHostState()

    const result = await syncOpenCodeImport({ overwriteState: false, importConfig: false })

    expect(result.configImported).toBe(false)
    expect(result.stateImported).toBe(true)
    await expect(readFile(workspaceConfigPath('opencode.json'), 'utf8')).rejects.toThrow()
  })

  it('reads distinct session directories from imported workspace state', async () => {
    await mkdir(workspaceStateDir, { recursive: true })
    createStateDatabase(path.join(workspaceStateDir, 'opencode.db'), [
      '/Users/test/project-a',
      ' /Users/test/project-b/apps/web ',
    ])

    const result = await getImportedSessionDirectories()

    expect(result.directories).toHaveLength(2)
    expect([...result.directories].sort()).toEqual([
      '/Users/test/project-a',
      '/Users/test/project-b/apps/web',
    ].sort())
  })

  it('reports stateSourcePath as null when candidate directory exists but lacks opencode.db', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"model":"test/lower"}')
    const stateDir = path.join(home, 'host-state')
    await mkdir(stateDir, { recursive: true })
    process.env.OPENCODE_IMPORT_STATE_PATH = stateDir

    const status = await getOpenCodeImportStatus()

    expect(status.configSourcePath).toBe(process.env.OPENCODE_IMPORT_CONFIG_PATH)
    expect(status.stateSourcePath).toBeNull()
    expect(status.workspaceStateExists).toBe(false)
  })

  it('prevents destructive self-import when source and target resolve to same directory', async () => {
    const samePath = path.join(home, 'shared-opencode-state')
    await mkdir(samePath, { recursive: true })
    await writeFile(path.join(samePath, 'sentinel.txt'), 'keep', 'utf8')

    const result = await importOpenCodeStateDirectory(samePath, samePath)

    expect(result).toBe(false)
    await expect(readFile(path.join(samePath, 'sentinel.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('blocks import when workspace state exists and overwriteState is not enabled', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = await writeHostConfig('opencode.json', '{"model":"test/lower"}')
    process.env.OPENCODE_IMPORT_STATE_PATH = await createHostState()
    await mkdir(workspaceStateDir, { recursive: true })
    createStateDatabase(path.join(workspaceStateDir, 'opencode.db'))

    await expect(syncOpenCodeImport({
      overwriteState: false,
      protectExistingState: true,
    })).rejects.toThrow('OpenCode host import was blocked to protect existing workspace state')

    await expect(readFile(workspaceConfigPath('opencode.json'), 'utf8')).rejects.toThrow()
  })

  it('stages imported state before replacing the target directory', async () => {
    const sourcePath = path.join(home, 'staged-source')
    const targetPath = path.join(home, 'workspace', '.opencode', 'state', 'opencode')
    await mkdir(sourcePath, { recursive: true })
    await writeFile(path.join(sourcePath, 'stale-file.txt'), 'from source', 'utf8')
    createStateDatabase(path.join(sourcePath, 'opencode.db'))
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, 'old-file.txt'), 'from target', 'utf8')

    const result = await importOpenCodeStateDirectory(sourcePath, targetPath)

    expect(result).toBe(true)
    await expect(readFile(path.join(targetPath, 'stale-file.txt'), 'utf8')).resolves.toBe('from source')
    await expect(readFile(path.join(targetPath, 'opencode.db'))).resolves.toBeInstanceOf(Buffer)
    await expect(readFile(path.join(targetPath, 'old-file.txt'), 'utf8')).rejects.toThrow()
    await expect(readdir(path.dirname(targetPath))).resolves.toEqual(['opencode'])
    await expect(stagedDirectories(path.dirname(targetPath))).resolves.toEqual([])
  })

  it('imports only durable host state entries and keeps nested directories named like excluded caches', async () => {
    const sourcePath = path.join(home, 'durable-source')
    const targetPath = path.join(home, 'workspace', '.opencode', 'state', 'opencode')

    const writeSourceFile = async (relativePath: string) => {
      const filePath = path.join(sourcePath, relativePath)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, relativePath)
    }

    for (const relativePath of [
      'auth.json',
      'storage/x',
      'storage/log/y',
      'project/project.json',
      'plans/plan.json',
      'forge/forge.json',
      'forge.db',
      'worktree/checkout/file',
      'snapshot/snapshot',
      'repos/repo',
      'bin/binary',
      'log/server',
      'tool-output/output',
      'shell/command',
      'debug.log',
    ]) {
      await writeSourceFile(relativePath)
    }
    createStateDatabase(path.join(sourcePath, 'opencode.db'))

    const result = await importOpenCodeStateDirectory(sourcePath, targetPath)

    expect(result).toBe(true)
    expect((await readdir(targetPath)).sort()).toEqual(
      ['auth.json', 'forge', 'forge.db', 'opencode.db', 'plans', 'project', 'storage'].sort(),
    )
    await expect(readFile(path.join(targetPath, 'storage', 'log', 'y'), 'utf8')).resolves.toBe('storage/log/y')
    await expect(readFile(path.join(targetPath, 'debug.log'), 'utf8')).rejects.toThrow()
  })

  it('skips the top-level entry that contains the import destination', () => {
    expect(shouldImportOpenCodeStateEntry('.opencode', '/host/opencode', '/host/opencode/.opencode/state/opencode')).toBe(false)
    expect(shouldImportOpenCodeStateEntry('storage', '/host/opencode', '/host/opencode/.opencode/state/opencode')).toBe(true)
    expect(shouldImportOpenCodeStateEntry('storage', '/host/opencode', '/elsewhere/.opencode/state/opencode')).toBe(true)
  })

  it('cleans up the staged import directory when snapshotting fails', async () => {
    const sourcePath = path.join(home, 'broken-source')
    const targetPath = path.join(home, 'workspace', '.opencode', 'state', 'opencode')
    await mkdir(sourcePath, { recursive: true })
    await writeFile(path.join(sourcePath, 'opencode.db'), 'not a sqlite database')
    await mkdir(targetPath, { recursive: true })

    await expect(importOpenCodeStateDirectory(sourcePath, targetPath)).rejects.toThrow()

    await expect(readdir(path.dirname(targetPath))).resolves.toEqual(['opencode'])
    await expect(readdir(targetPath)).resolves.toEqual([])
    await expect(stagedDirectories(path.dirname(targetPath))).resolves.toEqual([])
  })
})
