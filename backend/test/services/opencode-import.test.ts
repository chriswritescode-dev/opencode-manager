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

import { readdir } from 'fs/promises'
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

  it('detects importable host config and state paths', async () => {
    process.env.OPENCODE_IMPORT_CONFIG_PATH = '/import/opencode-config/opencode.json'
    process.env.OPENCODE_IMPORT_STATE_PATH = '/import/opencode-state'

    mockFileExists.mockImplementation(async (candidate: string) => {
      return candidate === '/import/opencode-config/opencode.json'
        || candidate === '/import/opencode-state'
        || candidate === '/tmp/workspace/.opencode/state/opencode/opencode.db'
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
})
