import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import path from 'path'
import { z } from 'zod'
import { Database } from 'bun:sqlite'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { JsonObjectSchema } from '@opencode-manager/shared/utils'
import { getConfigPath } from '@opencode-manager/shared/config/env'
import type { OpenCodeServerManager } from '../../src/services/opencode-single-server'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { OpenCodeConfigFile } from '../../src/types/settings'
import { SettingsService } from '../../src/services/settings'
import {
  applyOpenCodeConfigUpdate,
  captureLastKnownGoodOpenCodeConfig,
  restoreLastKnownGoodOpenCodeConfig,
  seedOpenCodeConfigFile,
  type ApplyOpenCodeConfigOptions,
  type ApplyOpenCodeConfigResult,
} from '../../src/services/opencode-config-apply'
import {
  OPENCODE_CONFIG_SEED,
  OpenCodeConfigConflictError,
  OpenCodeConfigSourceInvalidError,
  OpenCodeConfigValidationError,
  readOpenCodeConfigFile,
  writeOpenCodeConfigFile,
} from '../../src/services/opencode-config-file'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTestDatabase } from '../helpers/test-database'
import { applyTestEnv, createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import { expectLoggedMessage } from '../helpers/log-assertions'

const ConfigSnapshotSchema = z.object({
  version: z.number(),
  sources: z.array(z.object({ name: z.string(), rawContent: z.string() })),
})

function parseSnapshot(snapshot: string) {
  return ConfigSnapshotSchema.parse(JSON.parse(snapshot))
}

async function applyExpectingStatus(
  input: ApplyOpenCodeConfigOptions,
  status: ApplyOpenCodeConfigResult['status'],
): Promise<OpenCodeConfigFile> {
  const result = await applyOpenCodeConfigUpdate(input)
  expect(result.status).toBe(status)
  return result.config
}

describe('opencode-config-apply', () => {
  let workspace: TempWorkspace
  let db: Database
  let settingsService: SettingsService
  let locationReload: Mock<OpenCodeApi['location']['reload']>
  let mcpAdd: Mock<OpenCodeApi['mcp']['add']>
  let mcpRemove: Mock<OpenCodeApi['mcp']['remove']>
  let configGet: Mock<OpenCodeApi['config']['get']>
  let markRestartPending: Mock<OpenCodeServerManager['markRestartPending']>
  let clearStartupError: Mock<OpenCodeServerManager['clearStartupError']>
  let openCodeClient: OpenCodeClient
  let restoreLogLevel: () => void

  function sourcePath(name: string): string {
    return path.join(getConfigPath(), name)
  }

  beforeAll(() => {
    restoreLogLevel = applyTestEnv({ LOG_LEVEL: 'error' })
  })

  afterAll(() => {
    restoreLogLevel()
  })

  beforeEach(async () => {
    workspace = createTempWorkspace('opencode-config-apply-')
    await mkdir(getConfigPath(), { recursive: true })
    db = createTestDatabase()
    settingsService = new SettingsService(db)
    locationReload = vi.fn<OpenCodeApi['location']['reload']>(async () => undefined)
    mcpAdd = vi.fn<OpenCodeApi['mcp']['add']>(async () => undefined)
    mcpRemove = vi.fn<OpenCodeApi['mcp']['remove']>(async () => undefined)
    configGet = vi.fn<OpenCodeApi['config']['get']>(async () => {
      throw new Error('OpenCode unavailable')
    })
    markRestartPending = vi.fn<OpenCodeServerManager['markRestartPending']>()
    clearStartupError = vi.fn<OpenCodeServerManager['clearStartupError']>()
    openCodeClient = createStubOpenCodeClient({
      api: {
        config: { get: configGet },
        location: { reload: locationReload },
        mcp: { add: mcpAdd, remove: mcpRemove },
      },
    })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it.each([
    ['theme', { theme: 'light' }],
    ['model', { model: 'a/b' }],
    ['agents', { agents: { reviewer: { description: 'Reviews' } } }],
    ['permissions', { permissions: [{ action: 'webfetch', resource: '*', effect: 'deny' }] }],
    ['plugins', { plugins: ['/plugins/probe'] }],
    ['providers', { providers: { example: { package: 'y' } } }],
  ])('reloads OpenCode without a restart for a semantic %s change', async (_field, change) => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    const config = await applyExpectingStatus({
      content: change,
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'reloaded')

    expect(locationReload).toHaveBeenCalledTimes(1)
    expect(markRestartPending).not.toHaveBeenCalled()
    expect(config.content).toEqual(change)
  })

  it('keeps an unchanged {env:} reference when a merge patch resends the resolved value', async () => {
    await writeFile(
      sourcePath('opencode.json'),
      '{\n  // keep me\n  "providers": { "acme": { "settings": { "apiKey": "{env:ACME_KEY}" } } }\n}\n',
      'utf8',
    )
    configGet.mockResolvedValue([
      {
        type: 'document',
        path: sourcePath('opencode.json'),
        info: { providers: { acme: { settings: { apiKey: 'secret' } } } },
      },
    ])

    await applyOpenCodeConfigUpdate({
      content: { providers: { acme: { name: 'Acme', settings: { apiKey: 'secret' } } } },
      mode: 'merge',
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })

    const written = await readFile(sourcePath('opencode.json'), 'utf8')
    expect(written).toContain('"apiKey": "{env:ACME_KEY}"')
    expect(written).toContain('"name": "Acme"')
    expect(written).toContain('// keep me')
    expect(written).not.toContain('secret')
  })

  it('refuses an entity merge patch without writing when the resolved config cannot be read', async () => {
    const original = '{\n  "providers": { "acme": { "settings": { "apiKey": "{env:ACME_KEY}" } } }\n}\n'
    await writeFile(sourcePath('opencode.json'), original, 'utf8')

    await expect(applyOpenCodeConfigUpdate({
      content: { providers: { acme: { name: 'Acme', settings: { apiKey: 'secret' } } } },
      mode: 'merge',
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })).rejects.toThrow('OpenCode unavailable')

    expect(await readFile(sourcePath('opencode.json'), 'utf8')).toBe(original)
  })

  it('saves a merge patch without named entities while OpenCode is unavailable', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    await applyOpenCodeConfigUpdate({
      content: { theme: 'light' },
      mode: 'merge',
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })

    expect(configGet).not.toHaveBeenCalled()
    expect(JsonObjectSchema.parse(JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')))).toEqual({
      theme: 'light',
    })
  })

  it('marks a restart pending when the reload fails', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')
    locationReload.mockRejectedValue(new Error('OpenCode server unavailable'))

    const config = await applyExpectingStatus({
      content: { theme: 'light' },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'restart_pending')

    expect(config.content).toEqual({ theme: 'light' })
    expect(markRestartPending).toHaveBeenCalledTimes(1)
    expectLoggedMessage('OpenCode configuration reload failed, marking a server restart as pending:', 'warn')
  })

  it('applies a comment-only edit without marking a restart pending', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')
    const commented = '{\n  // keep this comment\n  "theme": "dark"\n}\n'

    const config = await applyExpectingStatus({
      content: commented,
      source: 'opencode.json',
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'applied')

    expect(config.rawContent).toBe(commented)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(commented)
    expect(markRestartPending).not.toHaveBeenCalled()
    expect(locationReload).not.toHaveBeenCalled()
  })

  it('writes a raw string to the explicitly requested source verbatim', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    const submitted = '{\n  // config source\n  "theme": "light"\n}\n'

    const config = await applyExpectingStatus({
      content: submitted,
      source: 'opencode.jsonc',
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'reloaded')

    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(submitted)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
    expect(config.content).toEqual({ model: 'a/b', theme: 'light' })
  })

  it('throws a conflict and preserves last known good when the expected revision is stale', async () => {
    const initial = await writeOpenCodeConfigFile('{"theme":"dark"}', 'opencode.jsonc')
    settingsService.saveLastKnownGoodConfig('sentinel')
    await writeFile(sourcePath('opencode.json'), '{"theme":"light"}', 'utf8')

    await expect(applyOpenCodeConfigUpdate({
      content: { theme: 'system' },
      expectedRevision: initial.revision,
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })).rejects.toBeInstanceOf(OpenCodeConfigConflictError)

    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"theme":"light"}')
    expect(markRestartPending).not.toHaveBeenCalled()
  })

  it('saves the valid prior full snapshot as last known good after a successful write', async () => {
    const previous = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), previous, 'utf8')

    await applyOpenCodeConfigUpdate({
      content: { theme: 'light' },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })

    const lastGood = settingsService.getLastKnownGoodConfig()
    expect(lastGood).not.toBeNull()
    const parsed = parseSnapshot(z.string().parse(lastGood))
    expect(parsed.version).toBe(1)
    expect(parsed.sources).toEqual([{ name: 'opencode.json', rawContent: previous }])
  })

  it('rejects an object update when a source is invalid and keeps last known good', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model": 5}', 'utf8')
    settingsService.saveLastKnownGoodConfig('sentinel')

    await expect(applyOpenCodeConfigUpdate({
      content: { theme: 'light' },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })).rejects.toBeInstanceOf(OpenCodeConfigSourceInvalidError)

    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model": 5}')
    expect(markRestartPending).not.toHaveBeenCalled()
  })

  it('rejects invalid raw content and writes nothing', async () => {
    const previous = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), previous, 'utf8')

    await expect(applyOpenCodeConfigUpdate({
      content: '{"model": 5}',
      source: 'opencode.json',
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })).rejects.toBeInstanceOf(OpenCodeConfigValidationError)

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(previous)
    expect(markRestartPending).not.toHaveBeenCalled()
  })

  it('restores the prior sources if persisting last known good fails', async () => {
    const lower = '{"model":"a/b"}'
    const higher = '{\n // keep\n "theme":"dark"\n}'
    await writeFile(sourcePath('opencode.json'), lower)
    await writeFile(sourcePath('opencode.jsonc'), higher)
    vi.spyOn(settingsService, 'saveLastKnownGoodConfig').mockImplementation(() => {
      throw new Error('database write failed')
    })

    await expect(applyOpenCodeConfigUpdate({
      content: { model: 'a/b', theme: 'light' },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })).rejects.toThrow('database write failed')

    expect(await readFile(sourcePath('opencode.json'), 'utf8')).toBe(lower)
    expect(await readFile(sourcePath('opencode.jsonc'), 'utf8')).toBe(higher)
    expect(markRestartPending).not.toHaveBeenCalled()
  })

  it('reloads after repairing an invalid source even when merged values are unchanged', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":123}')
    await writeFile(sourcePath('opencode.jsonc'), '{"model":"a/b"}')

    const result = await applyOpenCodeConfigUpdate({
      content: '{}',
      source: 'opencode.json',
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    })

    expect(result.status).toBe('reloaded')
    expect(locationReload).toHaveBeenCalledOnce()
    expect(markRestartPending).not.toHaveBeenCalled()
  })

  it('preserves unknown fields sent back with the merged content', async () => {
    const raw = JSON.stringify({ theme: 'dark', customTool: { enabled: true } })
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')
    const current = await readOpenCodeConfigFile()
    if (current === null) throw new Error('expected a config file to exist')

    const config = await applyExpectingStatus({
      content: { ...current.content, theme: 'light' },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'reloaded')

    expect(config.content).toEqual({ theme: 'light', customTool: { enabled: true } })
    const onDisk = JsonObjectSchema.parse(JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')))
    expect(onDisk).toEqual({ theme: 'light', customTool: { enabled: true } })
  })

  it('captures every source as last known good and restores them together', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), '{"theme":"dark"}', 'utf8')

    await captureLastKnownGoodOpenCodeConfig(settingsService)
    await rm(sourcePath('opencode.json'))
    await rm(sourcePath('opencode.jsonc'))

    const restored = await restoreLastKnownGoodOpenCodeConfig(settingsService, { clearStartupError })

    expect(restored?.content).toEqual({ model: 'a/b', theme: 'dark' })
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe('{"theme":"dark"}')
    expect(clearStartupError).toHaveBeenCalledTimes(1)
  })

  it('does not capture an invalid prior snapshot as last known good', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model": 5}', 'utf8')
    settingsService.saveLastKnownGoodConfig('sentinel')

    const captured = await captureLastKnownGoodOpenCodeConfig(settingsService)

    expect(captured?.isValid).toBe(false)
    expect(settingsService.getLastKnownGoodConfig()).toBe('sentinel')
  })

  it('restores a legacy raw last known good snapshot as an opencode.json source', async () => {
    const service = { getLastKnownGoodConfig: () => '{"theme":"dark"}' }

    const restored = await restoreLastKnownGoodOpenCodeConfig(service, { clearStartupError })

    expect(restored?.content).toEqual({ theme: 'dark' })
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"theme":"dark"}')
    expect(clearStartupError).toHaveBeenCalledTimes(1)
  })

  it('returns null from restore when no last known good config exists', async () => {
    const service = { getLastKnownGoodConfig: () => null }

    expect(await restoreLastKnownGoodOpenCodeConfig(service, { clearStartupError })).toBeNull()
    expect(clearStartupError).not.toHaveBeenCalled()
  })

  it('reloads an mcp-only change without touching the MCP API', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')
    const server = { type: 'local' as const, command: ['npx', 'local'] }

    const config = await applyExpectingStatus({
      content: { theme: 'dark', mcp: { servers: { local: server } } },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'reloaded')

    expect(config.content).toEqual({ theme: 'dark', mcp: { servers: { local: server } } })
    expect(locationReload).toHaveBeenCalledOnce()
    expect(mcpAdd).not.toHaveBeenCalled()
    expect(mcpRemove).not.toHaveBeenCalled()
    expect(markRestartPending).not.toHaveBeenCalled()
  })

  it('reloads an mcp-only removal without touching the MCP API', async () => {
    const server = { type: 'local' as const, command: ['npx', 'local'] }
    await writeFile(sourcePath('opencode.json'), JSON.stringify({ theme: 'dark', mcp: { servers: { local: server } } }), 'utf8')

    await applyExpectingStatus({
      content: { theme: 'dark', mcp: { servers: {} } },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'reloaded')

    expect(locationReload).toHaveBeenCalledOnce()
    expect(mcpRemove).not.toHaveBeenCalled()
    expect(mcpAdd).not.toHaveBeenCalled()
  })

  it('reloads an mcp-only change that touches a legacy flat entry', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    await applyExpectingStatus({
      content: { theme: 'dark', mcp: { legacy: { type: 'local', command: ['npx', 'legacy'] } } },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'reloaded')

    expect(locationReload).toHaveBeenCalledOnce()
    expect(mcpAdd).not.toHaveBeenCalled()
    expect(mcpRemove).not.toHaveBeenCalled()
  })

  it('reloads when mcp changes alongside another key', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    const config = await applyExpectingStatus({
      content: { theme: 'light', mcp: { local: { type: 'local' } } },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'reloaded')

    expect(config.content).toEqual({ theme: 'light', mcp: { local: { type: 'local' } } })
    expect(locationReload).toHaveBeenCalledTimes(1)
  })

  it('applies an unchanged content edit without reloading or marking a restart pending', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    await applyExpectingStatus({
      content: { theme: 'dark' },
      settingsService,
      openCodeClient,
      manager: { markRestartPending },
    }, 'applied')

    expect(markRestartPending).not.toHaveBeenCalled()
    expect(locationReload).not.toHaveBeenCalled()
  })

  it('seeds a minimal opencode.jsonc snapshot and removes every other source', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    const seeded = await seedOpenCodeConfigFile()

    expect(seeded.path).toBe(sourcePath('opencode.jsonc'))
    expect(seeded.rawContent).toBe(OPENCODE_CONFIG_SEED)
    expect(seeded.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
    expect(seeded.isValid).toBe(true)
    await expect(readdir(getConfigPath())).resolves.toEqual(['opencode.jsonc'])
  })
})
