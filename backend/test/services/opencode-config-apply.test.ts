import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { Database } from 'bun:sqlite'
import { ZodError } from 'zod'

const paths = vi.hoisted(() => ({ config: '', healthWatch: '' }))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getOpenCodeConfigFilePath: () => paths.config,
  getOpenCodeHealthWatchPath: () => paths.healthWatch,
  OPENCODE_CONFIG_FILENAMES: ['config.json', 'opencode.json', 'opencode.jsonc'],
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const markRestartPendingMock = vi.hoisted(() => vi.fn())
const clearStartupErrorMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    markRestartPending: markRestartPendingMock,
    clearStartupError: clearStartupErrorMock,
  },
}))

import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import {
  applyOpenCodeConfigUpdate,
  captureLastKnownGoodOpenCodeConfig,
  restoreLastKnownGoodOpenCodeConfig,
  seedOpenCodeConfigFile,
  type ApplyOpenCodeConfigResult,
} from '../../src/services/opencode-config-apply'
import {
  OPENCODE_CONFIG_SEED,
  OpenCodeConfigConflictError,
  OpenCodeConfigSourceInvalidError,
  readOpenCodeConfigFile,
  writeOpenCodeConfigFile,
} from '../../src/services/opencode-config-file'

function expectStatus<T extends ApplyOpenCodeConfigResult['status']>(
  result: ApplyOpenCodeConfigResult,
  status: T,
): Extract<ApplyOpenCodeConfigResult, { status: T }> {
  expect(result.status).toBe(status)
  return result as Extract<ApplyOpenCodeConfigResult, { status: T }>
}

function parseSnapshot(snapshot: string): { version: number; sources: Array<{ name: string; rawContent: string }> } {
  return JSON.parse(snapshot) as { version: number; sources: Array<{ name: string; rawContent: string }> }
}

describe('opencode-config-apply', () => {
  let workDir: string
  let db: Database
  let settingsService: SettingsService

  function sourcePath(name: string): string {
    return path.join(workDir, name)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    workDir = await mkdtemp(path.join(tmpdir(), 'opencode-config-apply-'))
    paths.config = path.join(workDir, 'opencode.json')
    paths.healthWatch = path.join(workDir, 'health-watch')
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
  })

  afterEach(async () => {
    db.close()
    await rm(workDir, { recursive: true, force: true })
  })

  it.each([
    ['theme', { theme: 'light' }],
    ['model', { model: 'a/b' }],
    ['mcp', { mcp: { local: { type: 'local' } } }],
    ['agent', { agent: { build: { model: 'a/b' } } }],
    ['plugin', { plugin: ['x'] }],
    ['provider', { provider: { example: { npm: 'y' } } }],
  ])('marks a restart pending for a semantic %s change without patching the live server', async (_field, change) => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: change,
      settingsService,
    }), 'restart_pending')

    expect(markRestartPendingMock).toHaveBeenCalledTimes(1)
    expect(result.config.content).toEqual(change)
  })

  it('applies a comment-only edit without marking a restart pending', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')
    const commented = '{\n  // keep this comment\n  "theme": "dark"\n}\n'

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: commented,
      source: 'opencode.json',
      settingsService,
    }), 'applied')

    expect(result.config.rawContent).toBe(commented)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(commented)
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('writes a raw string to the explicitly requested source verbatim', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    const submitted = '{\n  // config source\n  "theme": "light"\n}\n'

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: submitted,
      source: 'config.json',
      settingsService,
    }), 'restart_pending')

    await expect(readFile(sourcePath('config.json'), 'utf8')).resolves.toBe(submitted)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
    expect(result.config.content).toEqual({ model: 'a/b', theme: 'light' })
  })

  it('throws a conflict and preserves last known good when the expected revision is stale', async () => {
    const initial = await writeOpenCodeConfigFile('{"theme":"dark"}', 'opencode.jsonc')
    settingsService.saveLastKnownGoodConfig('sentinel')
    await writeFile(sourcePath('opencode.json'), '{"theme":"light"}', 'utf8')

    await expect(applyOpenCodeConfigUpdate({
      content: { theme: 'system' },
      expectedRevision: initial.revision,
      settingsService,
    })).rejects.toBeInstanceOf(OpenCodeConfigConflictError)

    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"theme":"light"}')
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('saves the valid prior full snapshot as last known good after a successful write', async () => {
    const previous = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), previous, 'utf8')

    await applyOpenCodeConfigUpdate({
      content: { theme: 'light' },
      settingsService,
    })

    const lastGood = settingsService.getLastKnownGoodConfig()
    expect(lastGood).not.toBeNull()
    const parsed = parseSnapshot(lastGood as string)
    expect(parsed.version).toBe(1)
    expect(parsed.sources).toEqual([{ name: 'opencode.json', rawContent: previous }])
  })

  it('rejects an object update when a source is invalid and keeps last known good', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model": 5}', 'utf8')
    settingsService.saveLastKnownGoodConfig('sentinel')

    await expect(applyOpenCodeConfigUpdate({
      content: { theme: 'light' },
      settingsService,
    })).rejects.toBeInstanceOf(OpenCodeConfigSourceInvalidError)

    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model": 5}')
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('rejects invalid raw content and writes nothing', async () => {
    const previous = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), previous, 'utf8')

    await expect(applyOpenCodeConfigUpdate({
      content: '{"model": 5}',
      source: 'opencode.json',
      settingsService,
    })).rejects.toBeInstanceOf(ZodError)

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(previous)
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('restores the prior sources if persisting last known good fails', async () => {
    const lower = '{"model":"a/b"}'
    const higher = '{\n // keep\n "theme":"dark"\n}'
    await writeFile(sourcePath('config.json'), lower)
    await writeFile(sourcePath('opencode.jsonc'), higher)
    vi.spyOn(settingsService, 'saveLastKnownGoodConfig').mockImplementation(() => {
      throw new Error('database write failed')
    })

    await expect(applyOpenCodeConfigUpdate({
      content: { model: 'a/b', theme: 'light' },
      settingsService,
    })).rejects.toThrow('database write failed')

    expect(await readFile(sourcePath('config.json'), 'utf8')).toBe(lower)
    expect(await readFile(sourcePath('opencode.jsonc'), 'utf8')).toBe(higher)
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('requires a restart after repairing an invalid source even when merged values are unchanged', async () => {
    await writeFile(sourcePath('config.json'), '{"model":123}')
    await writeFile(sourcePath('opencode.jsonc'), '{"model":"a/b"}')

    const result = await applyOpenCodeConfigUpdate({
      content: '{}',
      source: 'config.json',
      settingsService,
    })

    expect(result.status).toBe('restart_pending')
    expect(markRestartPendingMock).toHaveBeenCalledOnce()
  })

  it('preserves unknown fields sent back with the merged content', async () => {
    const raw = JSON.stringify({ theme: 'dark', customTool: { enabled: true } })
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')
    const current = await readOpenCodeConfigFile()

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: { ...current!.content, theme: 'light' },
      settingsService,
    }), 'restart_pending')

    expect(result.config.content).toEqual({ theme: 'light', customTool: { enabled: true } })
    const onDisk = JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')) as Record<string, unknown>
    expect(onDisk).toEqual({ theme: 'light', customTool: { enabled: true } })
  })

  it('captures every source as last known good and restores them together', async () => {
    await writeFile(sourcePath('config.json'), '{"model":"a/b"}', 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), '{"theme":"dark"}', 'utf8')

    await captureLastKnownGoodOpenCodeConfig(settingsService)
    await rm(sourcePath('config.json'))
    await rm(sourcePath('opencode.jsonc'))

    const restored = await restoreLastKnownGoodOpenCodeConfig(settingsService)

    expect(restored?.content).toEqual({ model: 'a/b', theme: 'dark' })
    await expect(readFile(sourcePath('config.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe('{"theme":"dark"}')
    expect(clearStartupErrorMock).toHaveBeenCalledTimes(1)
  })

  it('does not capture an invalid prior snapshot as last known good', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model": 5}', 'utf8')
    settingsService.saveLastKnownGoodConfig('sentinel')

    const captured = await captureLastKnownGoodOpenCodeConfig(settingsService)

    expect(captured?.isValid).toBe(false)
    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
  })

  it('restores a legacy raw last known good snapshot as an opencode.json source', async () => {
    const service = { getLastKnownGoodConfig: () => '{"theme":"dark"}' } as unknown as SettingsService

    const restored = await restoreLastKnownGoodOpenCodeConfig(service)

    expect(restored?.content).toEqual({ theme: 'dark' })
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"theme":"dark"}')
    expect(clearStartupErrorMock).toHaveBeenCalledTimes(1)
  })

  it('returns null from restore when no last known good config exists', async () => {
    const service = { getLastKnownGoodConfig: () => null } as unknown as SettingsService

    expect(await restoreLastKnownGoodOpenCodeConfig(service)).toBeNull()
    expect(clearStartupErrorMock).not.toHaveBeenCalled()
  })

  it('seeds a minimal opencode.jsonc snapshot and removes every other source', async () => {
    await writeFile(sourcePath('config.json'), '{"model":"a/b"}', 'utf8')
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    const seeded = await seedOpenCodeConfigFile()

    expect(seeded.path).toBe(sourcePath('opencode.jsonc'))
    expect(seeded.rawContent).toBe(OPENCODE_CONFIG_SEED)
    expect(seeded.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
    expect(seeded.isValid).toBe(true)
    await expect(readdir(workDir)).resolves.toEqual(['opencode.jsonc'])
  })
})
