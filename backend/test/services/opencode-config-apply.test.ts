import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { Database } from 'bun:sqlite'
import { ZodError } from 'zod'

const paths = vi.hoisted(() => ({ config: '' }))

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return {
    ...actual,
    getOpenCodeConfigFilePath: () => paths.config,
  }
})

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const patchConfigWithRecoveryMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/opencode/config-recovery', () => ({
  patchConfigWithRecovery: patchConfigWithRecoveryMock,
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
import { applyOpenCodeConfigUpdate, captureLastKnownGoodOpenCodeConfig, restoreLastKnownGoodOpenCodeConfig, type ApplyOpenCodeConfigResult } from '../../src/services/opencode-config-apply'
import type { OpenCodeClient } from '../../src/services/opencode/client'

function expectStatus<T extends ApplyOpenCodeConfigResult['status']>(
  result: ApplyOpenCodeConfigResult,
  status: T,
): Extract<ApplyOpenCodeConfigResult, { status: T }> {
  expect(result.status).toBe(status)
  return result as Extract<ApplyOpenCodeConfigResult, { status: T }>
}

describe('opencode-config-apply', () => {
  let workDir: string
  let db: Database
  let settingsService: SettingsService
  let openCodeClient: OpenCodeClient

  beforeEach(async () => {
    vi.clearAllMocks()
    workDir = await mkdtemp(path.join(tmpdir(), 'opencode-config-apply-'))
    paths.config = path.join(workDir, 'opencode.json')
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    openCodeClient = { forward: vi.fn() } as unknown as OpenCodeClient
  })

  afterEach(async () => {
    db.close()
    await rm(workDir, { recursive: true, force: true })
  })

  it('writes the file and marks a restart pending for a plugin change without patching the live server', async () => {
    await writeFile(paths.config, '{"theme":"dark"}', 'utf8')

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: '{"theme":"dark","plugin":["x"]}',
      openCodeClient,
      settingsService,
    }), 'restart_pending')

    expect(result.config.rawContent).toBe('{"theme":"dark","plugin":["x"]}')
    await expect(readFile(paths.config, 'utf8')).resolves.toBe('{"theme":"dark","plugin":["x"]}')
    expect(markRestartPendingMock).toHaveBeenCalledTimes(1)
    expect(patchConfigWithRecoveryMock).not.toHaveBeenCalled()
  })

  it('patches a live-applied change and writes the submitted raw text verbatim', async () => {
    await writeFile(paths.config, '{"theme":"dark"}', 'utf8')
    patchConfigWithRecoveryMock.mockResolvedValue({
      success: true,
      appliedConfig: { theme: 'dark', mcp: { local: { type: 'local' } } },
    })

    const submitted = '{\n  // keep this comment\n  "theme": "dark",\n  "mcp": { "local": { "type": "local" } }\n}\n'
    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: submitted,
      openCodeClient,
      settingsService,
    }), 'applied')

    expect(result.removedFields).toEqual([])
    await expect(readFile(paths.config, 'utf8')).resolves.toBe(submitted)
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('writes the cleaned applied config and reports removed fields when recovery drops them', async () => {
    await writeFile(paths.config, '{"theme":"dark"}', 'utf8')
    const appliedConfig = { mcp: { local: { type: 'local' } } }
    patchConfigWithRecoveryMock.mockResolvedValue({
      success: true,
      appliedConfig,
      removedFields: ['theme'],
    })

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: '{"theme":"dark","mcp":{"local":{"type":"local"}}}',
      openCodeClient,
      settingsService,
    }), 'applied')

    expect(result.removedFields).toEqual(['theme'])
    await expect(readFile(paths.config, 'utf8')).resolves.toBe(JSON.stringify(appliedConfig, null, 2))
  })

  it('leaves the previous file byte-identical and returns rejected when the live patch fails', async () => {
    const previous = '{\n  // previous\n  "theme": "dark"\n}\n'
    await writeFile(paths.config, previous, 'utf8')
    patchConfigWithRecoveryMock.mockResolvedValue({
      success: false,
      error: 'model: must be string',
      details: [{ path: 'model', message: 'must be string' }],
      removedFields: ['model'],
    })

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: { model: 'x' },
      openCodeClient,
      settingsService,
    }), 'rejected')

    expect(result.error).toBe('model: must be string')
    expect(result.validationIssues).toEqual([{ path: 'model', message: 'must be string' }])
    expect(result.removedFields).toEqual(['model'])
    await expect(readFile(paths.config, 'utf8')).resolves.toBe(previous)
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('saves a valid previous file as last known good before writing', async () => {
    const previous = '{"theme":"dark"}'
    await writeFile(paths.config, previous, 'utf8')
    patchConfigWithRecoveryMock.mockResolvedValue({ success: true })

    await applyOpenCodeConfigUpdate({
      content: { mcp: {} },
      openCodeClient,
      settingsService,
    })

    expect(settingsService.getLastKnownGoodConfig()).toBe(previous)
    expect(settingsService.getSettings().preferences.lastKnownGoodConfig).toBe(previous)
  })

  it('does not capture an invalid previous file as last known good', async () => {
    await writeFile(paths.config, '{"model": 5}', 'utf8')
    settingsService.saveLastKnownGoodConfig('sentinel')
    patchConfigWithRecoveryMock.mockResolvedValue({ success: true })

    const result = expectStatus(await applyOpenCodeConfigUpdate({
      content: { theme: 'light' },
      openCodeClient,
      settingsService,
    }), 'applied')

    expect(result.config.rawContent).toBe('{\n  "theme": "light"\n}')
    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
  })

  it('captures the on-disk config as last known good when it is valid', async () => {
    const previous = '{"theme":"dark"}'
    await writeFile(paths.config, previous, 'utf8')
    settingsService.saveLastKnownGoodConfig('sentinel')

    const captured = await captureLastKnownGoodOpenCodeConfig(settingsService)

    expect(captured?.rawContent).toBe(previous)
    expect(settingsService.getLastKnownGoodConfig()).toBe(previous)
  })

  it('does not overwrite last known good when the on-disk config is invalid', async () => {
    await writeFile(paths.config, '{"model": 5}', 'utf8')
    settingsService.saveLastKnownGoodConfig('sentinel')

    const captured = await captureLastKnownGoodOpenCodeConfig(settingsService)

    expect(captured?.isValid).toBe(false)
    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
  })

  it('returns null from restore when no last known good config exists', async () => {
    const service = { getLastKnownGoodConfig: () => null } as unknown as SettingsService

    expect(await restoreLastKnownGoodOpenCodeConfig(service)).toBeNull()
    expect(clearStartupErrorMock).not.toHaveBeenCalled()
  })

  it('writes the last known good config and clears the startup error on restore', async () => {
    const service = { getLastKnownGoodConfig: () => '{"theme":"dark"}' } as unknown as SettingsService

    const restored = await restoreLastKnownGoodOpenCodeConfig(service)

    expect(restored?.rawContent).toBe('{"theme":"dark"}')
    await expect(readFile(paths.config, 'utf8')).resolves.toBe('{"theme":"dark"}')
    expect(clearStartupErrorMock).toHaveBeenCalledTimes(1)
  })

  it('throws ZodError and writes nothing when the submitted content is invalid', async () => {
    const previous = '{"theme":"dark"}'
    await writeFile(paths.config, previous, 'utf8')

    await expect(applyOpenCodeConfigUpdate({
      content: '{"model": 5}',
      openCodeClient,
      settingsService,
    })).rejects.toBeInstanceOf(ZodError)

    await expect(readFile(paths.config, 'utf8')).resolves.toBe(previous)
    expect(patchConfigWithRecoveryMock).not.toHaveBeenCalled()
    expect(markRestartPendingMock).not.toHaveBeenCalled()
  })

  it('serializes concurrent applies so their live patches do not interleave', async () => {
    await writeFile(paths.config, '{"theme":"dark"}', 'utf8')

    const events: string[] = []
    let releaseFirstPatch!: () => void
    patchConfigWithRecoveryMock
      .mockImplementationOnce(() => {
        events.push('first:start')
        return new Promise((resolve) => {
          releaseFirstPatch = () => {
            events.push('first:end')
            resolve({ success: true })
          }
        })
      })
      .mockImplementationOnce(() => {
        events.push('second:start')
        return Promise.resolve({ success: true })
      })

    const first = applyOpenCodeConfigUpdate({
      content: { mcp: { first: { type: 'local' } } },
      openCodeClient,
      settingsService,
    })
    await vi.waitFor(() => expect(events).toContain('first:start'))

    const second = applyOpenCodeConfigUpdate({
      content: { mcp: { second: { type: 'local' } } },
      openCodeClient,
      settingsService,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events).toEqual(['first:start'])

    releaseFirstPatch()
    await Promise.all([first, second])

    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })
})
