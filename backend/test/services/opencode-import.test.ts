import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('fs/promises', () => ({
  cp: vi.fn(),
  readdir: vi.fn(),
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
  writeFileContent: vi.fn(),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getOpenCodeConfigFilePath: vi.fn(() => '/tmp/workspace/.config/opencode/opencode.json'),
  getWorkspacePath: vi.fn(() => '/tmp/workspace'),
}))

import path from 'path'
import { readdir, rm, cp } from 'fs/promises'
import { Database as SQLiteDatabase } from 'bun:sqlite'
import { ensureDirectoryExists, fileExists, readFileContent, writeFileContent } from '../../src/services/file-operations'
import { SettingsService } from '../../src/services/settings'
import { getOpenCodeImportStatus, syncOpenCodeImport } from '../../src/services/opencode-import'

const mockReaddir = readdir as unknown as ReturnType<typeof vi.fn>
const mockFileExists = fileExists as ReturnType<typeof vi.fn>
const mockReadFileContent = readFileContent as ReturnType<typeof vi.fn>
const mockWriteFileContent = writeFileContent as ReturnType<typeof vi.fn>
const mockEnsureDirectoryExists = ensureDirectoryExists as ReturnType<typeof vi.fn>
const MockSettingsService = SettingsService as unknown as ReturnType<typeof vi.fn>
const MockSQLiteDatabase = SQLiteDatabase as unknown as ReturnType<typeof vi.fn>

describe('opencode-import service', () => {
  const mockDb = {} as unknown as Database
  const settingsService = {
    getOpenCodeConfigByName: vi.fn(),
    updateOpenCodeConfig: vi.fn(),
    createOpenCodeConfig: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    MockSettingsService.mockImplementation(() => settingsService)
    mockReadFileContent.mockResolvedValue('{"$schema":"https://opencode.ai/config.json"}')
    mockReaddir.mockResolvedValue([])
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

    settingsService.getOpenCodeConfigByName.mockReturnValue({ name: 'default' })

    const result = await syncOpenCodeImport({
      db: mockDb,
      userId: 'default',
      overwriteState: true,
    })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(true)
    expect(result.workspaceStateExists).toBe(true)
    expect(settingsService.updateOpenCodeConfig).toHaveBeenCalledWith('default', {
      content: '{"$schema":"https://opencode.ai/config.json"}',
      isDefault: true,
    }, 'default')
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      '/tmp/workspace/.config/opencode/opencode.json',
      '{"$schema":"https://opencode.ai/config.json"}'
    )
    expect(mockEnsureDirectoryExists).toHaveBeenCalledWith('/tmp/workspace/.opencode/state/opencode')
    expect(MockSQLiteDatabase).toHaveBeenCalledWith('/import/opencode-state/opencode.db')
  })

  it('does not report state imported when source db is missing', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === '/import/opencode-config/opencode.json'
        || candidate === '/import/opencode-state'
    })

    const result = await syncOpenCodeImport({
      db: mockDb,
      userId: 'default',
      overwriteState: true,
    })

    expect(result.configImported).toBe(true)
    expect(result.stateImported).toBe(false)
    expect(mockEnsureDirectoryExists).not.toHaveBeenCalled()
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

  it('removes stale non-DB artifacts before copying new state during overwrite import', async () => {
    const { importOpenCodeStateDirectory } = await import('../../src/services/opencode-import')

    const sourcePath = '/import/opencode-state'
    const targetPath = '/workspace/.opencode/state/opencode'

    mockFileExists.mockImplementation(async (candidate: string) => {
      if (candidate === path.join(sourcePath, 'opencode.db')) {
        return true
      }
      if (candidate === path.join(targetPath, 'opencode.db')) {
        return true
      }
      return false
    })

    mockReaddir.mockResolvedValue([
      { name: 'stale-file.txt', isDirectory: () => false },
      { name: 'stale-folder', isDirectory: () => true },
      { name: 'opencode.db', isDirectory: () => false },
      { name: 'opencode.db-shm', isDirectory: () => false },
      { name: 'opencode.db-wal', isDirectory: () => false },
    ] as any)

    mockEnsureDirectoryExists.mockResolvedValue(undefined)
    const mockRm = vi.mocked(rm)
    mockRm.mockResolvedValue(undefined)

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
    expect(mockRm).toHaveBeenCalledWith(
      path.join(targetPath, 'stale-file.txt'),
      { recursive: true, force: true }
    )
    expect(mockRm).toHaveBeenCalledWith(
      path.join(targetPath, 'stale-folder'),
      { recursive: true, force: true }
    )
    expect(mockCp).toHaveBeenCalled()
    expect(mockExec).toHaveBeenCalled()
  })
})
