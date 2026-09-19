import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  cp: vi.fn(),
  mkdtemp: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}))

vi.mock('bun:sqlite', () => ({
  Database: vi.fn().mockImplementation(() => ({
    exec: vi.fn(),
    close: vi.fn(),
  })),
}))

vi.mock('../../src/services/file-operations', () => ({
  ensureDirectoryExists: vi.fn(),
  fileExists: vi.fn(),
  readFileContent: vi.fn(),
}))

vi.mock('../../src/services/opencode-config-file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/opencode-config-file')>()),
  readOpenCodeConfigFile: vi.fn(),
  writeOpenCodeConfigFile: vi.fn(),
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    clearStartupError: vi.fn(),
  },
}))

vi.mock('../../src/services/opencode/config-recovery', () => ({
  patchConfigWithRecovery: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getOpenCodeConfigFilePath: vi.fn(() => '/tmp/workspace/.config/opencode/opencode.json'),
  getWorkspacePath: vi.fn(() => '/tmp/workspace'),
}))

import path from 'path'
import { existsSync } from 'node:fs'
import { readdir, rm, cp, mkdtemp, rename } from 'fs/promises'
import { Database as SQLiteDatabase } from 'bun:sqlite'
import { ensureDirectoryExists, fileExists, readFileContent } from '../../src/services/file-operations'
import { readOpenCodeConfigFile, writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import type { SettingsService } from '../../src/services/settings'
import { getFirstExistingConfigSourcePath, getOpenCodeImportStatus, syncOpenCodeImport } from '../../src/services/opencode-import'

const mockReaddir = readdir as unknown as ReturnType<typeof vi.fn>
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>
const mockFileExists = fileExists as ReturnType<typeof vi.fn>
const mockReadFileContent = readFileContent as ReturnType<typeof vi.fn>
const mockEnsureDirectoryExists = ensureDirectoryExists as ReturnType<typeof vi.fn>
const mockReadOpenCodeConfigFile = readOpenCodeConfigFile as ReturnType<typeof vi.fn>
const mockWriteOpenCodeConfigFile = writeOpenCodeConfigFile as ReturnType<typeof vi.fn>
const MockSQLiteDatabase = SQLiteDatabase as unknown as ReturnType<typeof vi.fn>
const mockMkdtemp = mkdtemp as unknown as ReturnType<typeof vi.fn>
const mockRename = rename as unknown as ReturnType<typeof vi.fn>

describe('opencode-import service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileContent.mockResolvedValue('{"$schema":"https://opencode.ai/config.json"}')
    mockReaddir.mockResolvedValue([])
    mockMkdtemp.mockResolvedValue('/tmp/workspace/.opencode/state/opencode-import-123')
    mockRename.mockResolvedValue(undefined)
    mockExistsSync.mockImplementation((candidate: string) => candidate === process.env.OPENCODE_IMPORT_CONFIG_PATH)
  })

  it('detects importable host config and state paths with opencode.db', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      if (candidate === '/import/opencode-config/opencode.json') {
        return true
      }
      if (candidate === '/import/opencode-state') {
        return true
      }
      if (candidate === '/import/opencode-state/opencode.db') {
        return true
      }
      if (candidate === '/tmp/workspace/.opencode/state/opencode/opencode.db') {
        return true
      }
      return false
    })

    const status = await getOpenCodeImportStatus()

    expect(status).toEqual({
      configSourcePath: '/import/opencode-config/opencode.json',
      stateSourcePath: '/import/opencode-state',
      workspaceConfigPath: '/tmp/workspace/.config/opencode/opencode.json',
      workspaceStatePath: '/tmp/workspace/.opencode/state/opencode',
      workspaceStateExists: true,
    })
  })

  it('imports host config and state into the workspace', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === '/import/opencode-config/opencode.json'
        || candidate === '/import/opencode-state'
        || candidate === '/import/opencode-state/opencode.db'
        || candidate === '/tmp/workspace/.opencode/state/opencode/opencode.db'
    })

    const result = await syncOpenCodeImport({
      overwriteState: true,
    })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(true)
    expect(result.workspaceStateExists).toBe(true)
    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalledWith(
      '{"$schema":"https://opencode.ai/config.json"}'
    )
    expect(mockEnsureDirectoryExists).toHaveBeenCalledWith('/tmp/workspace/.opencode/state')
    expect(MockSQLiteDatabase).toHaveBeenCalledWith('/import/opencode-state/opencode.db')
    expect(mockRename).toHaveBeenCalledWith(
      '/tmp/workspace/.opencode/state/opencode-import-123',
      '/tmp/workspace/.opencode/state/opencode'
    )
  })

  it('captures the previous on-disk config as last known good before importing over it', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'

    mockFileExists.mockImplementation(async (candidate: string) => candidate === '/import/opencode-config/opencode.json')
    mockReadOpenCodeConfigFile.mockResolvedValue({
      isValid: true,
      rawContent: '{"theme":"previous"}',
    })
    const settingsService = { saveLastKnownGoodConfig: vi.fn() } as unknown as SettingsService

    await syncOpenCodeImport({ overwriteState: true, settingsService })

    expect(settingsService.saveLastKnownGoodConfig).toHaveBeenCalledWith('{"theme":"previous"}')
    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalledWith('{"$schema":"https://opencode.ai/config.json"}')
  })

  it('does not capture last known good when no previous config file exists', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'

    mockFileExists.mockImplementation(async (candidate: string) => candidate === '/import/opencode-config/opencode.json')
    mockReadOpenCodeConfigFile.mockResolvedValue(null)
    const settingsService = { saveLastKnownGoodConfig: vi.fn() } as unknown as SettingsService

    await syncOpenCodeImport({ overwriteState: true, settingsService })

    expect(settingsService.saveLastKnownGoodConfig).not.toHaveBeenCalled()
    expect(mockWriteOpenCodeConfigFile).toHaveBeenCalled()
  })

  it('does not report state imported when source db is missing', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === '/import/opencode-config/opencode.json'
        || candidate === '/import/opencode-state'
    })

    const result = await syncOpenCodeImport({
      overwriteState: true,
    })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(false)
    expect(mockEnsureDirectoryExists).not.toHaveBeenCalled()
  })

  it('resolves the first existing import config candidate synchronously', () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = process.execPath

    expect(getFirstExistingConfigSourcePath()).toBe(process.execPath)
  })

  it('rejects invalid importable config content with the existing error', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'

    mockFileExists.mockImplementation(async (candidate: string) => candidate === '/import/opencode-config/opencode.json')
    mockReadFileContent.mockResolvedValue('{"model": 123}')

    await expect(syncOpenCodeImport({ overwriteState: true })).rejects.toThrow('Importable OpenCode config is invalid')
    expect(mockWriteOpenCodeConfigFile).not.toHaveBeenCalled()
  })

  it('imports state without rewriting the config when importConfig is false', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === '/import/opencode-config/opencode.json'
        || candidate === '/import/opencode-state'
        || candidate === '/import/opencode-state/opencode.db'
    })

    const result = await syncOpenCodeImport({ overwriteState: false, importConfig: false })

    expect(result.configImported).toBe(false)
    expect(result.stateImported).toBe(true)
    expect(mockWriteOpenCodeConfigFile).not.toHaveBeenCalled()
  })

  it('reads distinct session directories from imported workspace state', async () => {
    mockFileExists.mockImplementation(async (candidate: string) => candidate === '/tmp/workspace/.opencode/state/opencode/opencode.db')

    const readonlyDatabase = {
      query: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([
          { directory: '/Users/test/project-a' },
          { directory: ' /Users/test/project-b/apps/web ' },
        ]),
      }),
      close: vi.fn(),
    }

    MockSQLiteDatabase.mockImplementationOnce(() => readonlyDatabase)

    const { getImportedSessionDirectories } = await import('../../src/services/opencode-import')
    const result = await getImportedSessionDirectories('/tmp/workspace/.opencode/state/opencode')

    expect(result.directories).toEqual([
      '/Users/test/project-a',
      '/Users/test/project-b/apps/web',
    ])
    expect(readonlyDatabase.close).toHaveBeenCalled()
  })

  it('reports stateSourcePath as null when candidate directory exists but lacks opencode.db', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      if (candidate === '/import/opencode-config/opencode.json') {
        return true
      }
      if (candidate === '/import/opencode-state') {
        return true
      }
      if (candidate === '/import/opencode-state/opencode.db') {
        return false
      }
      if (candidate === '/tmp/workspace/.opencode/state/opencode/opencode.db') {
        return false
      }
      return false
    })

    const status = await getOpenCodeImportStatus()

    expect(status.configSourcePath).toBe('/import/opencode-config/opencode.json')
    expect(status.stateSourcePath).toBeNull()
    expect(status.workspaceStateExists).toBe(false)
  })

  it('prevents destructive self-import when source and target resolve to same directory', async () => {
    const { importOpenCodeStateDirectory } = await import('../../src/services/opencode-import')

    const samePath = '/shared/opencode-state'
    mockFileExists.mockResolvedValue(true)
    mockEnsureDirectoryExists.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])

    const mockRm = vi.mocked(rm)
    mockRm.mockResolvedValue(undefined)

    const result = await importOpenCodeStateDirectory(samePath, samePath)

    expect(result).toBe(false)
    expect(mockRm).not.toHaveBeenCalled()
    expect(MockSQLiteDatabase).not.toHaveBeenCalled()
  })

  it('blocks import when workspace state exists and overwriteState is not enabled', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === '/import/opencode-config/opencode.json'
        || candidate === '/import/opencode-state'
        || candidate === '/import/opencode-state/opencode.db'
        || candidate === '/tmp/workspace/.opencode/state/opencode/opencode.db'
    })

    await expect(syncOpenCodeImport({
      overwriteState: false,
      protectExistingState: true,
    })).rejects.toThrow('OpenCode host import was blocked to protect existing workspace state')

    expect(mockWriteOpenCodeConfigFile).not.toHaveBeenCalled()
    expect(mockEnsureDirectoryExists).not.toHaveBeenCalled()
  })

  it('stages imported state before replacing the target directory', async () => {
    const { importOpenCodeStateDirectory } = await import('../../src/services/opencode-import')

    const sourcePath = '/import/opencode-state'
    const targetPath = '/workspace/.opencode/state/opencode'
    const stagedPath = '/workspace/.opencode/state/opencode-import-123'

    mockFileExists.mockImplementation(async (candidate: string) => {
      if (candidate === path.join(sourcePath, 'opencode.db')) {
        return true
      }
      return false
    })

    mockEnsureDirectoryExists.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([
      { name: 'stale-file.txt', isDirectory: () => false },
      { name: 'opencode.db', isDirectory: () => false },
    ] as any)
    const mockRm = vi.mocked(rm)
    mockRm.mockResolvedValue(undefined)
    mockMkdtemp.mockResolvedValue(stagedPath)

    const mockCp = vi.mocked(cp)
    mockCp.mockResolvedValue(undefined)

    const mockExec = vi.fn()
    const mockClose = vi.fn()
    MockSQLiteDatabase.mockImplementationOnce(() => ({
      exec: mockExec,
      close: mockClose,
    }))

    const result = await importOpenCodeStateDirectory(sourcePath, targetPath)

    expect(result).toBe(true)
    expect(mockCp).toHaveBeenCalledWith(
      path.join(sourcePath, 'stale-file.txt'),
      path.join(stagedPath, 'stale-file.txt'),
      expect.any(Object)
    )
    expect(mockExec).toHaveBeenCalled()
    expect(mockRm).toHaveBeenCalledWith(targetPath, { recursive: true, force: true })
    expect(mockRename).toHaveBeenCalledWith(stagedPath, targetPath)
  })

  it('cleans up the staged import directory when snapshotting fails', async () => {
    const { importOpenCodeStateDirectory } = await import('../../src/services/opencode-import')

    const sourcePath = '/import/opencode-state'
    const targetPath = '/workspace/.opencode/state/opencode'
    const stagedPath = '/workspace/.opencode/state/opencode-import-456'

    mockFileExists.mockImplementation(async (candidate: string) => candidate === path.join(sourcePath, 'opencode.db'))
    mockEnsureDirectoryExists.mockResolvedValue(undefined)
    mockMkdtemp.mockResolvedValue(stagedPath)

    const mockExec = vi.fn(() => {
      throw new Error('snapshot failed')
    })
    const mockClose = vi.fn()
    MockSQLiteDatabase.mockImplementationOnce(() => ({
      exec: mockExec,
      close: mockClose,
    }))

    const mockRm = vi.mocked(rm)
    mockRm.mockResolvedValue(undefined)

    await expect(importOpenCodeStateDirectory(sourcePath, targetPath)).rejects.toThrow('snapshot failed')

    expect(mockRm).toHaveBeenCalledWith(stagedPath, { recursive: true, force: true })
    expect(mockRm).not.toHaveBeenCalledWith(targetPath, { recursive: true, force: true })
    expect(mockRename).not.toHaveBeenCalled()
  })
})
