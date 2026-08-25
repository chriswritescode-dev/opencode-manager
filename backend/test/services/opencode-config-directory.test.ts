import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { promises as fs } from 'fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return {
    ...actual,
    FILE_LIMITS: {
      MAX_SIZE_BYTES: 1024 * 1024,
      MAX_UPLOAD_SIZE_BYTES: 500,
    },
  }
})

const mockValidateOpenCodeConfigContent = vi.fn()
const mockUpsertDefaultOpenCodeConfig = vi.fn()
const mockBunWrite = vi.fn()

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn(() => ({
    validateOpenCodeConfigContent: mockValidateOpenCodeConfigContent,
    upsertDefaultOpenCodeConfig: mockUpsertDefaultOpenCodeConfig,
  })),
}))

import { SettingsService } from '../../src/services/settings'

interface TestUploadFile {
  relativePath: string
  file: File
}

function payload(files: Array<[string, string]>): TestUploadFile[] {
  return files.map(([relativePath, content]) => ({
    relativePath,
    file: new File([content], relativePath.split('/').pop() ?? relativePath),
  }))
}

async function listParentEntries(parent: string): Promise<string[]> {
  try {
    return await readdir(parent)
  } catch {
    return []
  }
}

function createConfigZodError(): z.ZodError {
  try {
    z.object({ theme: z.string() }).parse({ theme: 42 })
  } catch (error) {
    return error as z.ZodError
  }
  throw new Error('expected schema parse to fail')
}

describe('replaceOpenCodeConfigDirectory', () => {
  let tempDir: string
  let configDir: string
  let mockDb: Database

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await mkdtemp(join(tmpdir(), 'oc-config-dir-test-'))
    configDir = join(tempDir, '.config', 'opencode')
    vi.spyOn(await import('@opencode-manager/shared/config/env'), 'getConfigPath').mockReturnValue(configDir)
    mockDb = { query: vi.fn() } as unknown as Database
    mockValidateOpenCodeConfigContent.mockReturnValue({})
    mockUpsertDefaultOpenCodeConfig.mockReturnValue({ name: 'default', isDefault: true })
    mockBunWrite.mockImplementation(async (targetPath: string, file: File) => {
      await writeFile(targetPath, Buffer.from(await file.arrayBuffer()))
    })
    vi.stubGlobal('Bun', { write: mockBunWrite })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('replaces the directory with the uploaded tree, normalizing the config and restoring executables', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(join(configDir, 'agents'), { recursive: true })
    await writeFile(join(configDir, 'agents', 'old.md'), 'old')

    const jsonc = `{
  // comment
  "$schema": "https://opencode.ai/config.json",
  "theme": "dark"
}`
    const result = await replaceOpenCodeConfigDirectory(mockDb, payload([
      ['my-config/opencode.jsonc', jsonc],
      ['my-config/AGENTS.md', '# Project'],
      ['my-config/agents/team/planner.md', '# Planner'],
      ['my-config/commands/deploy.md', '# Deploy'],
      ['my-config/skills/quo-api/SKILL.md', '---\nname: quo-api\n---\nBody'],
      ['my-config/skills/quo-api/scripts/quo-spec.sh', '#!/usr/bin/env bash\necho hi'],
      ['my-config/plugin/opencode-forge/dist/index.js', 'console.log(1)'],
      ['my-config/vendor/x.js', 'var x = 1'],
      ['my-config/postgres-mcp-manager.sh', '#!/bin/sh\npsql'],
    ]))

    expect(SettingsService).toHaveBeenCalledWith(mockDb)
    expect(mockValidateOpenCodeConfigContent).toHaveBeenCalledWith(jsonc)
    expect(mockUpsertDefaultOpenCodeConfig).toHaveBeenCalledWith(jsonc, 'default')
    expect(result.configSourceFilename).toBe('opencode.jsonc')
    expect(result.filesInstalled).toEqual([
      'opencode.json',
      'AGENTS.md',
      'agents/team/planner.md',
      'commands/deploy.md',
      'skills/quo-api/SKILL.md',
      'skills/quo-api/scripts/quo-spec.sh',
      'plugin/opencode-forge/dist/index.js',
      'vendor/x.js',
      'postgres-mcp-manager.sh',
    ])
    expect(result.executablesRestored).toEqual(['postgres-mcp-manager.sh', 'skills/quo-api/scripts/quo-spec.sh'])
    expect(result.skippedPaths).toEqual([])
    expect(result.preservedEntries).toEqual([])

    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe(jsonc)
    await expect(readFile(join(configDir, 'opencode.jsonc'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(configDir, 'skills/quo-api/scripts/quo-spec.sh'), 'utf8')).toBe('#!/usr/bin/env bash\necho hi')
    expect(await readFile(join(configDir, 'postgres-mcp-manager.sh'), 'utf8')).toBe('#!/bin/sh\npsql')
    expect(await readFile(join(configDir, 'plugin/opencode-forge/dist/index.js'), 'utf8')).toBe('console.log(1)')

    expect((await stat(join(configDir, 'skills/quo-api/scripts/quo-spec.sh'))).mode & 0o111).toBe(0o111)
    expect((await stat(join(configDir, 'postgres-mcp-manager.sh'))).mode & 0o111).toBe(0o111)
    expect((await stat(join(configDir, 'AGENTS.md'))).mode & 0o111).toBe(0)

    await expect(readFile(join(configDir, 'agents', 'old.md'), 'utf8')).rejects.toThrow()

    const parentEntries = await listParentEntries(join(tempDir, '.config'))
    expect(parentEntries.filter((name) => name.startsWith('.opencode-config-staging-') || name.startsWith('.opencode-config-backup-'))).toEqual([])
  })

  it('prefers opencode.json and reports the uploaded opencode.jsonc as skipped', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    const result = await replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme":"dark"}'],
      ['opencode.jsonc', '{ // c\n"theme":"light"\n}'],
    ]))

    expect(result.configSourceFilename).toBe('opencode.json')
    expect(result.skippedPaths).toEqual(['opencode.jsonc'])
    expect(mockUpsertDefaultOpenCodeConfig).toHaveBeenCalledWith('{"theme":"dark"}', 'default')
    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"dark"}')
    await expect(readFile(join(configDir, 'opencode.jsonc'), 'utf8')).rejects.toThrow()
  })

  it('preserves an existing node_modules directory while skipping uploaded excluded entries', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(join(configDir, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(configDir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1')

    const result = await replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme":"dark"}'],
      ['node_modules/installed.js', 'x'],
      ['plugin/pkg/node_modules/inner.js', 'y'],
      ['.git/config', '[core]'],
      ['.DS_Store', 'junk'],
      ['agents/team.md', '# Team'],
    ]))

    expect(result.preservedEntries).toEqual(['node_modules'])
    expect(result.skippedPaths).toEqual([
      'node_modules/installed.js',
      'plugin/pkg/node_modules/inner.js',
      '.git/config',
      '.DS_Store',
    ])
    expect(await readFile(join(configDir, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('module.exports = 1')
    await expect(readFile(join(configDir, 'node_modules', 'installed.js'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(configDir, '.git', 'config'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(configDir, '.DS_Store'), 'utf8')).rejects.toThrow()
  })

  it('computes the common upload root from kept paths, ignoring excluded siblings', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    const result = await replaceOpenCodeConfigDirectory(mockDb, payload([
      ['my-config/opencode.json', '{"theme":"dark"}'],
      ['my-config/AGENTS.md', '# Project'],
      ['other/node_modules/installed.js', 'x'],
    ]))

    expect(result.filesInstalled).toEqual(['opencode.json', 'AGENTS.md'])
    expect(result.skippedPaths).toEqual(['other/node_modules/installed.js'])
    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(await readFile(join(configDir, 'AGENTS.md'), 'utf8')).toBe('# Project')
    await expect(readFile(join(configDir, 'other', 'node_modules', 'installed.js'), 'utf8')).rejects.toThrow()
  })

  it('rejects a payload with no root config file, leaving the old directory untouched', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(join(configDir, 'agents'), { recursive: true })
    await writeFile(join(configDir, 'agents', 'existing.md'), 'keep me')
    await writeFile(join(configDir, 'opencode.json'), '{"theme":"old"}')

    await expect(replaceOpenCodeConfigDirectory(mockDb, payload([
      ['AGENTS.md', '# Project'],
      ['agents/planner.md', '# Planner'],
    ]))).rejects.toThrow('Uploaded directory must contain opencode.json or opencode.jsonc at its root')

    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"old"}')
    expect(await readFile(join(configDir, 'agents', 'existing.md'), 'utf8')).toBe('keep me')
    const parentEntries = await listParentEntries(join(tempDir, '.config'))
    expect(parentEntries.filter((name) => name.startsWith('.opencode-config-staging-') || name.startsWith('.opencode-config-backup-'))).toEqual([])
  })

  it('rejects when the config fails validation before touching disk', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    mockValidateOpenCodeConfigContent.mockImplementationOnce(() => {
      throw createConfigZodError()
    })
    await mkdir(join(configDir, 'agents'), { recursive: true })
    await writeFile(join(configDir, 'agents', 'existing.md'), 'keep me')
    await writeFile(join(configDir, 'opencode.json'), '{"theme":"old"}')

    const error = await replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme": 42}'],
      ['agents/planner.md', '# Planner'],
    ])).catch((caught) => caught)

    expect(error).toBeInstanceOf(z.ZodError)
    expect(mockValidateOpenCodeConfigContent).toHaveBeenCalledWith('{"theme": 42}')
    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"old"}')
    expect(await readFile(join(configDir, 'agents', 'existing.md'), 'utf8')).toBe('keep me')
    const parentEntries = await listParentEntries(join(tempDir, '.config'))
    expect(parentEntries.filter((name) => name.startsWith('.opencode-config-staging-') || name.startsWith('.opencode-config-backup-'))).toEqual([])
  })

  it('does not persist to the database when the filesystem phase fails', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(join(configDir, 'agents'), { recursive: true })
    await writeFile(join(configDir, 'agents', 'existing.md'), 'keep me')
    await writeFile(join(configDir, 'opencode.json'), '{"theme":"old"}')
    mockBunWrite.mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device')
    })

    const error = await replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme":"new"}'],
      ['agents/planner.md', '# Planner'],
    ])).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('ENOSPC')
    expect(mockValidateOpenCodeConfigContent).toHaveBeenCalledWith('{"theme":"new"}')
    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"old"}')
    expect(await readFile(join(configDir, 'agents', 'existing.md'), 'utf8')).toBe('keep me')
    const parentEntries = await listParentEntries(join(tempDir, '.config'))
    expect(parentEntries.filter((name) => name.startsWith('.opencode-config-staging-') || name.startsWith('.opencode-config-backup-'))).toEqual([])
  })

  it('reports success when a post-swap node_modules preservation step fails', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(join(configDir, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(configDir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1')

    const realRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (String(newPath).includes('node_modules')) {
        throw new Error('EACCES: permission denied')
      }
      return realRename(oldPath, newPath)
    })

    const result = await replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme":"dark"}'],
    ]))

    expect(result.filesInstalled).toEqual(['opencode.json'])
    expect(result.preservedEntries).toEqual([])
    expect(mockUpsertDefaultOpenCodeConfig).toHaveBeenCalledWith('{"theme":"dark"}', 'default')
    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"dark"}')
    await expect(readFile(join(configDir, 'node_modules', 'dep', 'index.js'), 'utf8')).rejects.toThrow()
    const parentEntries = await listParentEntries(join(tempDir, '.config'))
    expect(parentEntries.filter((name) => name.startsWith('.opencode-config-staging-') || name.startsWith('.opencode-config-backup-'))).toEqual([])
  })

  it('rejects a path containing .. before any disk mutation', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), '{"theme":"old"}')

    await expect(replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme":"new"}'],
      ['../escape.md', 'x'],
    ]))).rejects.toThrow('Path must not contain ".."')

    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"old"}')
    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('rejects a "." manifest relative path before any disk mutation', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), '{"theme":"old"}')

    await expect(replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme":"new"}'],
      ['.', 'x'],
    ]))).rejects.toThrow('Path must not be empty')

    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"old"}')
    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('rejects payloads exceeding the upload size limit', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), '{"theme":"old"}')

    const big = 'x'.repeat(600)
    await expect(replaceOpenCodeConfigDirectory(mockDb, payload([
      ['opencode.json', '{"theme":"new"}'],
      ['plugin/opencode-forge/dist/big.js', big],
    ]))).rejects.toThrow('Uploaded config directory files exceed maximum upload size')

    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"old"}')
    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('rejects payloads with more files than the configured maximum', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), '{"theme":"old"}')

    const tooMany = Array.from({ length: 5001 }, (_, index) => [`file${index}.md`, '# x'] as [string, string])
    await expect(replaceOpenCodeConfigDirectory(mockDb, payload(tooMany)))
      .rejects.toThrow('Uploaded config directory contains too many files (max 5000)')

    expect(await readFile(join(configDir, 'opencode.json'), 'utf8')).toBe('{"theme":"old"}')
    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('rejects when every uploaded entry is excluded', async () => {
    const { replaceOpenCodeConfigDirectory } = await import('../../src/services/opencode-config-directory')
    await expect(replaceOpenCodeConfigDirectory(mockDb, payload([
      ['.DS_Store', 'junk'],
      ['node_modules/x.js', 'x'],
    ]))).rejects.toThrow('No files were provided for the OpenCode config directory replace')

    expect(mockUpsertDefaultOpenCodeConfig).not.toHaveBeenCalled()
    const parentEntries = await listParentEntries(join(tempDir, '.config'))
    expect(parentEntries.filter((name) => name.startsWith('.opencode-config-staging-') || name.startsWith('.opencode-config-backup-'))).toEqual([])
  })
})
