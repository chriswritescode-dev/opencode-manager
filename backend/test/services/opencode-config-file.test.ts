import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const paths = vi.hoisted(() => ({ config: '', configDir: '', configHome: '', healthWatch: '' }))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getConfigPath: () => paths.configDir,
  getOpenCodeConfigFilePath: () => paths.config,
  getOpenCodeConfigHome: () => paths.configHome,
  getOpenCodeHealthWatchPath: () => paths.healthWatch,
  OPENCODE_CONFIG_SOURCE_NAMES: ['opencode.json', 'opencode.jsonc'],
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const writeFailures = vi.hoisted(() => ({
  paths: [] as string[],
  calls: [] as string[],
  readsAtWrite: [] as Array<{ stat: number; readFile: number }>,
}))

const fsCalls = vi.hoisted(() => ({ stat: 0, readFile: 0 }))

const writeGate = vi.hoisted(() => ({
  beforeWrite: null as null | (() => Promise<void>),
  entered: null as null | (() => void),
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    stat: vi.fn((...args: Parameters<typeof actual.stat>) => {
      fsCalls.stat += 1
      return actual.stat(...args)
    }),
    readFile: vi.fn((...args: Parameters<typeof actual.readFile>) => {
      fsCalls.readFile += 1
      return actual.readFile(...args)
    }),
  }
})

vi.mock('../../src/utils/fs-safe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/fs-safe')>()
  return {
    ...actual,
    writeFileAtomic: vi.fn(async (filePath: string, content: string, options?: { mode?: number }) => {
      writeFailures.calls.push(filePath)
      writeFailures.readsAtWrite.push({ stat: fsCalls.stat, readFile: fsCalls.readFile })
      if (writeGate.beforeWrite) {
        const gate = writeGate.beforeWrite
        writeGate.entered?.()
        await gate()
      }
      if (writeFailures.paths.includes(filePath)) {
        throw new Error(`simulated write failure for ${filePath}`)
      }
      return actual.writeFileAtomic(filePath, content, options)
    }),
  }
})

import { LEGACY_OPENCODE_CONFIG_SOURCE_NAME } from '@opencode-manager/shared'
import {
  HEALTH_WATCH_MAX_ENTRIES,
  OPENCODE_CONFIG_REDACTED_VALUE,
  OPENCODE_CONFIG_SEED,
  OpenCodeConfigConflictError,
  OpenCodeConfigRedactedValueError,
  OpenCodeConfigShadowedRemovalError,
  OpenCodeConfigSnapshotError,
  OpenCodeConfigValidationError,
  archiveBrokenOpenCodeConfigFile,
  deleteOpenCodeConfigFile,
  foldLegacyConfigJsonSource,
  pruneHealthWatchDirectory,
  readOpenCodeConfigFile,
  readOpenCodeConfigSnapshot,
  restoreLegacyOpenCodeConfigBackup,
  restoreOpenCodeConfigSnapshot,
  serializeOpenCodeConfigSnapshot,
  updateOpenCodeConfigFile,
  writeHealthWatchArtifact,
  writeOpenCodeConfigFile,
} from '../../src/services/opencode-config-file'
import { withFileLock } from '../../src/utils/atomic-json'

describe('opencode-config-file', () => {
  let workDir: string

  function sourcePath(name: string): string {
    return path.join(workDir, name)
  }

  function archiveDirectory(): string {
    return path.join(paths.configHome, 'opencode-configs-archive')
  }

  async function readArchivedLegacyContents(): Promise<string[]> {
    const entries = await readdir(archiveDirectory())
    return Promise.all(
      entries.map((entry) => readFile(path.join(archiveDirectory(), entry), 'utf8')),
    )
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    writeFailures.paths = []
    writeFailures.calls = []
    writeFailures.readsAtWrite = []
    fsCalls.stat = 0
    fsCalls.readFile = 0
    writeGate.beforeWrite = null
    writeGate.entered = null
    workDir = await mkdtemp(path.join(tmpdir(), 'opencode-config-file-'))
    paths.config = path.join(workDir, 'opencode.json')
    paths.configDir = workDir
    paths.configHome = path.join(workDir, '..', `${path.basename(workDir)}-home`)
    paths.healthWatch = path.join(workDir, 'health-watch')
    await mkdir(paths.configHome, { recursive: true })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
    await rm(paths.configHome, { recursive: true, force: true })
  })

  it('returns null when no config source exists', async () => {
    await expect(readOpenCodeConfigFile()).resolves.toBeNull()
  })

  it('writes a valid config to the default jsonc source and reads it back', async () => {
    const written = await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    expect(written.path).toBe(sourcePath('opencode.jsonc'))
    expect(written.rawContent).toBe(OPENCODE_CONFIG_SEED)
    expect(written.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
    expect(written.isValid).toBe(true)
    expect(written.updatedAt).toBeGreaterThan(0)
    expect(written.revision).toMatch(/^[a-f0-9]{64}$/)
    await expect(readdir(workDir)).resolves.toEqual(['opencode.jsonc'])
  })

  it('preserves an existing non-default file mode when rewriting atomically', async () => {
    const previousUmask = process.umask(0)
    try {
      await writeFile(sourcePath('opencode.jsonc'), OPENCODE_CONFIG_SEED, 'utf8')
      await chmod(sourcePath('opencode.jsonc'), 0o640)

      await writeOpenCodeConfigFile('{"theme":"dark"}')

      const stats = await stat(sourcePath('opencode.jsonc'))
      expect(stats.mode & 0o777).toBe(0o640)
    } finally {
      process.umask(previousUmask)
    }
  })

  it('rejects invalid content with a validation error and leaves the previous file untouched', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    await expect(writeOpenCodeConfigFile('{"model": 5}')).rejects.toBeInstanceOf(OpenCodeConfigValidationError)
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(OPENCODE_CONFIG_SEED)
  })

  it('parses JSONC comments and preserves the raw content', async () => {
    const rawContent = '{\n  // user comment\n  "theme": "dark"\n}\n'
    await writeFile(sourcePath('opencode.json'), rawContent, 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.path).toBe(sourcePath('opencode.json'))
    expect(file?.content).toEqual({ theme: 'dark' })
    expect(file?.rawContent).toBe(rawContent)
    expect(file?.isValid).toBe(true)
  })

  it('merges sources in opencode.json, opencode.jsonc precedence with recursive objects and replacing arrays', async () => {
    await writeFile(sourcePath('opencode.json'), JSON.stringify({ provider: { a: { x: 1 } }, list: [1, 2] }), 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), JSON.stringify({ provider: { a: { y: 2 } }, list: [3] }), 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.content).toEqual({ provider: { a: { x: 1, y: 2 } }, list: [3] })
    expect(file?.path).toBe(sourcePath('opencode.jsonc'))
    expect(file?.sources?.map((source) => source.name)).toEqual(['opencode.json', 'opencode.jsonc'])
  })

  it('reads and writes an existing jsonc source without creating a duplicate', async () => {
    await writeFile(sourcePath('opencode.jsonc'), '{\n  // comment\n  "theme": "dark"\n}\n', 'utf8')

    const file = await readOpenCodeConfigFile()
    expect(file?.path).toBe(sourcePath('opencode.jsonc'))

    await writeOpenCodeConfigFile('{"theme":"light"}')

    await expect(readdir(workDir)).resolves.toEqual(['opencode.jsonc'])
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe('{"theme":"light"}')
  })

  it('preserves unknown keys from raw parsed config rather than normalized schema output', async () => {
    const raw = JSON.stringify({ theme: 'dark', customTool: { enabled: true }, mystery: 7 }, null, 2)
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.content).toEqual({ theme: 'dark', customTool: { enabled: true }, mystery: 7 })
    expect(file?.sources?.[0]?.content).toEqual({ theme: 'dark', customTool: { enabled: true }, mystery: 7 })
  })

  it('reports validation issues for schema-invalid content', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model": 5}', 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.isValid).toBe(false)
    expect(file?.validationIssues?.[0]?.path).toBe('model')
  })

  it('reports a root validation issue when the file is not valid JSONC', async () => {
    await writeFile(sourcePath('opencode.json'), '{ not json', 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.isValid).toBe(false)
    expect(file?.validationIssues?.[0]?.path).toBe('root')
  })

  it('maps validation issues to dotted paths with a root fallback', async () => {
    await writeFile(sourcePath('opencode.json'), JSON.stringify({ agents: { a: { mode: 'boss' } } }), 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.isValid).toBe(false)
    expect(file?.validationIssues?.[0]?.path).toBe('agents.a.mode')
  })

  it('modifies only changed paths in the preferred source and preserves comments and untouched fields', async () => {
    const lower = '{\n  // lower config\n  "model": "lower/model",\n  "theme": "light"\n}\n'
    const target = '{\n  // target config\n  "theme": "dark",\n  "small_model": "small"\n}\n'
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')

    const merged = (await readOpenCodeConfigFile())?.content ?? {}
    const updated = await updateOpenCodeConfigFile({ ...merged, theme: 'light' })

    expect(updated.content).toEqual({ model: 'lower/model', theme: 'light', small_model: 'small' })
    const targetContent = await readFile(sourcePath('opencode.jsonc'), 'utf8')
    expect(targetContent).toContain('// target config')
    expect(targetContent).toContain('"theme": "light"')
    expect(targetContent).toContain('"small_model": "small"')
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
  })

  it('merges only the patched paths and leaves every other field untouched', async () => {
    const lower = '{\n  // lower config\n  "model": "lower/model"\n}\n'
    const target = '{\n  // target config\n  "theme": "dark",\n  "small_model": "small"\n}\n'
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')

    const updated = await updateOpenCodeConfigFile({ theme: 'light' }, { mode: 'merge' })

    expect(updated.content).toEqual({ model: 'lower/model', theme: 'light', small_model: 'small' })
    const targetContent = await readFile(sourcePath('opencode.jsonc'), 'utf8')
    expect(targetContent).toContain('// target config')
    expect(targetContent).toContain('"theme": "light"')
    expect(targetContent).toContain('"small_model": "small"')
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
  })

  it('merges a nested patch, creating paths that do not exist yet', async () => {
    const raw = JSON.stringify({
      mcp: {
        servers: {
          linear: { type: 'remote', url: 'https://linear.example.com', headers: { Authorization: 'Bearer old' } },
        },
      },
    })
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    const updated = await updateOpenCodeConfigFile(
      {
        mcp: {
          servers: {
            linear: { headers: { Authorization: 'Bearer new' } },
            github: { type: 'local', command: ['npx', 'github'] },
          },
        },
      },
      { mode: 'merge' },
    )

    expect(updated.content).toEqual({
      mcp: {
        servers: {
          linear: { type: 'remote', url: 'https://linear.example.com', headers: { Authorization: 'Bearer new' } },
          github: { type: 'local', command: ['npx', 'github'] },
        },
      },
    })
    const onDisk = JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')) as Record<string, unknown>
    expect(onDisk).toEqual(updated.content)
  })

  it('removes a patched path with a null value', async () => {
    await writeFile(sourcePath('opencode.json'), JSON.stringify({ theme: 'dark', small_model: 's' }), 'utf8')

    const updated = await updateOpenCodeConfigFile({ small_model: null }, { mode: 'merge' })

    expect(updated.content).toEqual({ theme: 'dark' })
    const onDisk = JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')) as Record<string, unknown>
    expect(onDisk).toEqual({ theme: 'dark' })
  })

  it('treats a merge patch with unchanged values as no change', async () => {
    const raw = '{\n  // keep this comment\n  "theme": "dark"\n}\n'
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    const updated = await updateOpenCodeConfigFile({ theme: 'dark' }, { mode: 'merge' })

    expect(updated.rawContent).toBe(raw)
  })

  it('rejects a merge patch whose merged result is schema-invalid and writes nothing', async () => {
    const raw = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    await expect(updateOpenCodeConfigFile({ model: 5 }, { mode: 'merge' })).rejects.toBeInstanceOf(OpenCodeConfigValidationError)

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(raw)
  })

  it('rejects a merge patch that removes a value only a lower-priority source defines', async () => {
    const lower = '{"theme":"light"}'
    const target = '{"model":"test/b"}'
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')

    const error = await updateOpenCodeConfigFile({ theme: null }, { mode: 'merge' }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCodeConfigShadowedRemovalError)
    expect((error as OpenCodeConfigShadowedRemovalError).paths).toEqual(['theme'])
    expect((error as OpenCodeConfigShadowedRemovalError).sources).toEqual(['opencode.json'])
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(target)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
  })

  it('merges into an existing nested object while deleting sibling keys with null', async () => {
    const raw = JSON.stringify({
      mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com', headers: { Authorization: 'Bearer old', 'X-Keep': '1' } } } },
    })
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    const updated = await updateOpenCodeConfigFile(
      { mcp: { servers: { linear: { headers: { Authorization: null } } } } },
      { mode: 'merge' },
    )

    expect(updated.content).toEqual({
      mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com', headers: { 'X-Keep': '1' } } } },
    })
    const onDisk = JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')) as Record<string, unknown>
    expect(onDisk).toEqual(updated.content)
  })

  it('strips nested nulls when a merge patch creates a new path', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

    const updated = await updateOpenCodeConfigFile(
      { mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com', headers: { Authorization: null, 'X-Trace': 'on' } } } } },
      { mode: 'merge' },
    )

    expect(updated.content).toEqual({
      theme: 'dark',
      mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com', headers: { 'X-Trace': 'on' } } } },
    })
    const onDisk = await readFile(sourcePath('opencode.json'), 'utf8')
    expect(onDisk).not.toContain('null')
    expect(JSON.parse(onDisk)).toEqual(updated.content)
  })

  it('rejects a redacted placeholder in a merge patch and writes nothing', async () => {
    const raw = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    const error = await updateOpenCodeConfigFile(
      { mcp: { servers: { linear: { headers: { Authorization: OPENCODE_CONFIG_REDACTED_VALUE } } } } },
      { mode: 'merge' },
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCodeConfigRedactedValueError)
    expect((error as OpenCodeConfigRedactedValueError).paths).toEqual(['mcp.servers.linear.headers.Authorization'])
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(raw)
  })

  it('rejects a redacted placeholder in replace content including array indexes and writes nothing', async () => {
    const raw = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    const error = await updateOpenCodeConfigFile({
      theme: 'light',
      instructions: ['keep', OPENCODE_CONFIG_REDACTED_VALUE],
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCodeConfigRedactedValueError)
    expect((error as OpenCodeConfigRedactedValueError).paths).toEqual(['instructions.1'])
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(raw)
  })

  it('rejects a redacted placeholder in raw content and writes nothing', async () => {
    const raw = '{"theme":"dark"}'
    await writeFile(sourcePath('opencode.json'), raw, 'utf8')

    const error = await updateOpenCodeConfigFile(
      `{\n  // comment\n  "instructions": ["keep", "${OPENCODE_CONFIG_REDACTED_VALUE}"],\n}\n`,
      { source: 'opencode.json' },
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCodeConfigRedactedValueError)
    expect((error as OpenCodeConfigRedactedValueError).paths).toEqual(['instructions.1'])
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(raw)
  })

  it('removes an override from the target source only and reveals inherited values', async () => {
    const lower = JSON.stringify({ theme: 'light', model: 'test/a' })
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), '{\n  "theme": "dark"\n}\n', 'utf8')

    await updateOpenCodeConfigFile({ model: 'test/a' })

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
    const revealed = await readOpenCodeConfigFile()
    expect(revealed?.content).toEqual({ theme: 'light', model: 'test/a' })
  })

  it('rejects a removal of a value that only a lower-priority source defines and writes nothing', async () => {
    const lower = '{\n  "theme": "light",\n  "model": "test/a"\n}\n'
    const target = '{\n  "model": "test/b"\n}\n'
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')
    const targetStats = await stat(sourcePath('opencode.jsonc'))

    const error = await updateOpenCodeConfigFile({ model: 'test/b' }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCodeConfigShadowedRemovalError)
    expect((error as OpenCodeConfigShadowedRemovalError).paths).toEqual(['theme'])
    expect((error as OpenCodeConfigShadowedRemovalError).sources).toEqual(['opencode.json'])
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(target)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
    expect((await stat(sourcePath('opencode.jsonc'))).mtimeMs).toBe(targetStats.mtimeMs)
  })

  it('rejects a mixed shadowed removal and legitimate change without writing anything', async () => {
    const lower = '{\n  "theme": "light",\n  "model": "test/a"\n}\n'
    const target = '{\n  "model": "test/b"\n}\n'
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')

    const error = await updateOpenCodeConfigFile({ model: 'test/b', plugin: ['x'] }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCodeConfigShadowedRemovalError)
    expect((error as OpenCodeConfigShadowedRemovalError).paths).toEqual(['theme'])
    expect((error as OpenCodeConfigShadowedRemovalError).sources).toEqual(['opencode.json'])
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(target)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
  })

  it('writes raw content to an explicitly requested allowlisted source and rejects unknown sources', async () => {
    const written = await writeOpenCodeConfigFile('{"theme":"dark"}', 'opencode.json')

    expect(written.path).toBe(sourcePath('opencode.json'))
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"theme":"dark"}')
    await expect(
      writeOpenCodeConfigFile('{"theme":"dark"}', 'nope.json' as 'opencode.json'),
    ).rejects.toThrow(/Unsupported OpenCode config source/)
  })

  it('throws OpenCodeConfigConflictError when the expected revision is stale', async () => {
    const initial = await writeOpenCodeConfigFile('{"theme":"dark"}')

    await expect(
      updateOpenCodeConfigFile({ theme: 'light' }, { expectedRevision: 'stale' }),
    ).rejects.toBeInstanceOf(OpenCodeConfigConflictError)

    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe('{"theme":"dark"}')

    const updated = await updateOpenCodeConfigFile({ theme: 'light' }, { expectedRevision: initial.revision })
    expect(updated.content).toEqual({ theme: 'light' })
  })

  it('round-trips every present and absent source state through a snapshot', async () => {
    const json = '{"model":"a/b"}'
    const jsonc = '{\n  // jsonc source\n  "small_model": "s"\n}\n'
    await writeFile(sourcePath('opencode.json'), json, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), jsonc, 'utf8')

    const snapshot = serializeOpenCodeConfigSnapshot((await readOpenCodeConfigFile())!)

    await deleteOpenCodeConfigFile()
    await expect(readOpenCodeConfigFile()).resolves.toBeNull()

    await restoreOpenCodeConfigSnapshot(snapshot)

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(json)
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(jsonc)
  })

  it('restores a legacy plain raw snapshot as an opencode.json-only source', async () => {
    await writeFile(sourcePath('opencode.jsonc'), '{"theme":"dark"}', 'utf8')

    const legacy = '{\n  // legacy\n  "model": "a/b"\n}\n'
    await restoreOpenCodeConfigSnapshot(legacy)

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(legacy)
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back already applied sources when restoring a snapshot fails', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"original"}', 'utf8')
    const snapshot = serializeOpenCodeConfigSnapshot({
      sources: [{
        name: 'opencode.jsonc',
        path: sourcePath('opencode.jsonc'),
        rawContent: '{"theme":"restored"}',
        content: { theme: 'restored' },
        isValid: true,
        updatedAt: 0,
      }],
    })

    writeFailures.paths.push(sourcePath('opencode.jsonc'))

    await expect(restoreOpenCodeConfigSnapshot(snapshot)).rejects.toThrow(/simulated write failure/)

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"theme":"original"}')
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('surfaces an AggregateError when rollback also fails', async () => {
    await writeFile(sourcePath('opencode.json'), '{"theme":"original"}', 'utf8')
    const snapshot = serializeOpenCodeConfigSnapshot({
      sources: [{
        name: 'opencode.jsonc',
        path: sourcePath('opencode.jsonc'),
        rawContent: '{"theme":"restored"}',
        content: { theme: 'restored' },
        isValid: true,
        updatedAt: 0,
      }],
    })

    writeFailures.paths.push(sourcePath('opencode.jsonc'), sourcePath('opencode.json'))

    await expect(restoreOpenCodeConfigSnapshot(snapshot)).rejects.toBeInstanceOf(AggregateError)
  })

  it('accepts a version 1 snapshot without the explicit marker', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    const snapshot = JSON.stringify({
      version: 1,
      sources: [{ name: 'opencode.jsonc', rawContent: '{"theme":"light"}' }],
    })

    await restoreOpenCodeConfigSnapshot(snapshot)

    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe('{"theme":"light"}')
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an unsupported snapshot version without changing sources', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    const snapshot = JSON.stringify({
      version: 2,
      sources: [{ name: 'opencode.jsonc', rawContent: '{"theme":"dark"}' }],
    })

    await expect(restoreOpenCodeConfigSnapshot(snapshot)).rejects.toBeInstanceOf(OpenCodeConfigSnapshotError)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a snapshot with a malformed sources shape without changing sources', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    const snapshot = JSON.stringify({ version: 1, sources: 'not-an-array' })

    await expect(restoreOpenCodeConfigSnapshot(snapshot)).rejects.toBeInstanceOf(OpenCodeConfigSnapshotError)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
  })

  it('rejects a snapshot with an unsupported marker without changing sources', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    const snapshot = JSON.stringify({
      marker: 'something-else',
      version: 1,
      sources: [{ name: 'opencode.jsonc', rawContent: '{"theme":"dark"}' }],
    })

    await expect(restoreOpenCodeConfigSnapshot(snapshot)).rejects.toBeInstanceOf(OpenCodeConfigSnapshotError)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
  })

  it('rejects a malformed legacy raw snapshot without changing sources', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')

    await expect(restoreOpenCodeConfigSnapshot('{ not jsonc')).rejects.toBeInstanceOf(OpenCodeConfigSnapshotError)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
  })

  it('validates all snapshot source contents before replacing any file', async () => {
    const rawContent = '{"model":"existing"}'
    await writeFile(sourcePath('opencode.json'), rawContent)
    const snapshot = JSON.stringify({ version: 1, sources: [
      { name: 'opencode.json', rawContent: '{"theme":"dark"}' },
      { name: 'opencode.jsonc', rawContent: '{"model":123}' },
    ] })

    await expect(restoreOpenCodeConfigSnapshot(snapshot)).rejects.toBeInstanceOf(OpenCodeConfigSnapshotError)
    expect(await readFile(sourcePath('opencode.json'), 'utf8')).toBe(rawContent)
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a schema-invalid legacy raw snapshot without changing sources', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')

    await expect(restoreOpenCodeConfigSnapshot('{"model":5}')).rejects.toBeInstanceOf(OpenCodeConfigSnapshotError)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
  })

  it('leaves sources untouched when an existing source cannot be read before restore', async () => {
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')
    await chmod(sourcePath('opencode.json'), 0o000)
    const snapshot = JSON.stringify({
      version: 1,
      sources: [{ name: 'opencode.jsonc', rawContent: '{"theme":"dark"}' }],
    })

    try {
      await expect(restoreOpenCodeConfigSnapshot(snapshot)).rejects.toThrow()
    } finally {
      await chmod(sourcePath('opencode.json'), 0o644)
    }

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":"a/b"}')
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips byte-identical structured and raw writes and preserves comments', async () => {
    const raw = '{\n  // keep\n  "theme": "dark"\n}\n'
    await writeFile(sourcePath('opencode.jsonc'), raw, 'utf8')
    const merged = (await readOpenCodeConfigFile())?.content ?? {}

    writeFailures.calls = []
    await updateOpenCodeConfigFile(merged)
    await updateOpenCodeConfigFile(raw)

    expect(writeFailures.calls).toEqual([])
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(raw)
  })

  it('uses a provided snapshot without re-reading sources before the write', async () => {
    await writeFile(sourcePath('opencode.jsonc'), '{"theme":"dark"}', 'utf8')
    const snapshot = await readOpenCodeConfigSnapshot()

    fsCalls.stat = 0
    fsCalls.readFile = 0
    await updateOpenCodeConfigFile({ theme: 'light' }, { snapshot })

    expect(writeFailures.readsAtWrite).toEqual([{ stat: 0, readFile: 0 }])
    expect(fsCalls.stat).toBe(2)
    expect(fsCalls.readFile).toBe(1)
  })

  it('replaces arrays atomically and merges nested objects in structured updates', async () => {
    await writeFile(
      sourcePath('opencode.jsonc'),
      JSON.stringify({ plugin: ['a'], provider: { p: { models: { m: { name: 'one' } } } } }),
      'utf8',
    )

    const updated = await updateOpenCodeConfigFile({
      plugin: ['b'],
      provider: { p: { models: { m: { name: 'two' }, n: { name: 'three' } } } },
    })

    expect(updated.content).toEqual({
      plugin: ['b'],
      provider: { p: { models: { m: { name: 'two' }, n: { name: 'three' } } } },
    })
  })

  it('treats prototype-named config keys as plain data without polluting prototypes', async () => {
    await writeFile(sourcePath('opencode.json'), '{"constructor":{"a":1}}', 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), '{"constructor":{"b":2}}', 'utf8')

    const file = await readOpenCodeConfigFile()
    expect(file?.content).toEqual({ constructor: { a: 1, b: 2 } })

    await updateOpenCodeConfigFile({ constructor: { a: 1, b: 2 }, prototype: { x: 1 } })

    const merged = await readOpenCodeConfigFile()
    expect(merged?.content).toEqual({ constructor: { a: 1, b: 2 }, prototype: { x: 1 } })
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('writes a health-watch artifact with a shared timestamp and returns its path', async () => {
    const artifactPath = await writeHealthWatchArtifact('opencode-health', (timestamp) => JSON.stringify({ capturedAt: timestamp }))

    expect(path.dirname(artifactPath)).toBe(paths.healthWatch)
    expect(path.basename(artifactPath)).toMatch(/^opencode-health-.+\.json$/)
    const content = JSON.parse(await readFile(artifactPath, 'utf8')) as { capturedAt: string }
    expect(content.capturedAt).toBe(path.basename(artifactPath).replace(/^opencode-health-/, '').replace(/\.json$/, ''))
  })

  it('archives the full source set under the health-watch directory', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')

    const archivePath = await archiveBrokenOpenCodeConfigFile()

    expect(archivePath).toBeTruthy()
    expect(path.dirname(archivePath as string)).toBe(paths.healthWatch)
    const archived = JSON.parse(await readFile(archivePath as string, 'utf8')) as {
      version: number
      sources: Array<{ name: string; rawContent: string }>
    }
    expect(archived.version).toBe(1)
    expect(archived.sources).toEqual(expect.arrayContaining([
      { name: 'opencode.jsonc', rawContent: OPENCODE_CONFIG_SEED },
      { name: 'opencode.json', rawContent: '{"model":"a/b"}' },
    ]))
  })

  it('returns null when archiving with no config source present', async () => {
    await expect(archiveBrokenOpenCodeConfigFile()).resolves.toBeNull()
  })

  it('prunes the health-watch directory to the newest entries', async () => {
    await mkdir(paths.healthWatch, { recursive: true })
    const baseTime = Date.now() - 100_000
    for (let index = 0; index < HEALTH_WATCH_MAX_ENTRIES + 5; index += 1) {
      const filePath = path.join(paths.healthWatch, `entry-${index}.json`)
      await writeFile(filePath, '{}', 'utf8')
      const time = new Date(baseTime + index * 1000)
      await utimes(filePath, time, time)
    }

    await pruneHealthWatchDirectory(paths.healthWatch)

    const remaining = await readdir(paths.healthWatch)
    expect(remaining).toHaveLength(HEALTH_WATCH_MAX_ENTRIES)
    expect(remaining).toContain(`entry-${HEALTH_WATCH_MAX_ENTRIES + 4}.json`)
    expect(remaining).not.toContain('entry-0.json')
    expect(remaining).not.toContain('entry-4.json')
  })

  it('caps the health-watch directory when archiving a broken config', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)
    await mkdir(paths.healthWatch, { recursive: true })
    const baseTime = Date.now() - 100_000
    for (let index = 0; index < HEALTH_WATCH_MAX_ENTRIES + 5; index += 1) {
      const filePath = path.join(paths.healthWatch, `old-${index}.json`)
      await writeFile(filePath, '{}', 'utf8')
      const time = new Date(baseTime + index * 1000)
      await utimes(filePath, time, time)
    }

    const archivePath = await archiveBrokenOpenCodeConfigFile()

    const remaining = await readdir(paths.healthWatch)
    expect(remaining).toHaveLength(HEALTH_WATCH_MAX_ENTRIES)
    expect(remaining).toContain(path.basename(archivePath as string))
  })

  it('deletes the entire source set and reports whether any source existed', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)
    await writeFile(sourcePath('opencode.json'), '{"model":"a/b"}', 'utf8')

    await expect(deleteOpenCodeConfigFile()).resolves.toBe(true)
    await expect(readdir(workDir)).resolves.toEqual([])
    await expect(deleteOpenCodeConfigFile()).resolves.toBe(false)
  })

  describe('v1 entity replacement', () => {
    it.each([
      {
        label: 'agents',
        v1Content: { agent: { reviewer: { description: 'Legacy reviewer' } } },
        patch: { agents: { reviewer: { description: 'New reviewer' } } },
        expected: { agents: { reviewer: { description: 'New reviewer' } } },
      },
      {
        label: 'commands',
        v1Content: { command: { build: { template: 'legacy template' } } },
        patch: { commands: { build: { template: 'new template' } } },
        expected: { commands: { build: { template: 'new template' } } },
      },
      {
        label: 'providers',
        v1Content: { provider: { example: { name: 'Legacy provider' } } },
        patch: { providers: { example: { name: 'Example provider' } } },
        expected: { providers: { example: { name: 'Example provider' } } },
      },
      {
        label: 'mcp servers',
        v1Content: { mcp: { linear: { type: 'remote', url: 'https://legacy.example.com' } } },
        patch: { mcp: { servers: { linear: { type: 'remote', url: 'https://current.example.com' } } } },
        expected: { mcp: { servers: { linear: { type: 'remote', url: 'https://current.example.com' } } } },
      },
      {
        label: 'permissions',
        v1Content: { permission: { edit: 'deny' } },
        patch: { permissions: [{ action: 'edit', resource: '*', effect: 'deny' }] },
        expected: { permissions: [{ action: 'edit', resource: '*', effect: 'deny' }] },
      },
    ])('replaces the v1 $label entry when saving its v2 entity', async ({ v1Content, patch, expected }) => {
      const raw = `{\n  // keep this comment\n  ${JSON.stringify(v1Content).slice(1, -1)}\n}\n`
      await writeFile(sourcePath('opencode.json'), raw, 'utf8')

      const updated = await updateOpenCodeConfigFile(patch, { mode: 'merge' })

      expect(updated.content).toEqual(expected)
      const onDisk = await readFile(sourcePath('opencode.json'), 'utf8')
      expect(onDisk).toContain('// keep this comment')
    })

    it('keeps the v2 mcp timeout when saving an MCP server named like a v2 mcp key', async () => {
      await writeFile(
        sourcePath('opencode.json'),
        JSON.stringify({ mcp: { timeout: { connect: 5000 }, servers: {} } }),
        'utf8',
      )

      const updated = await updateOpenCodeConfigFile(
        { mcp: { servers: { timeout: { type: 'remote', url: 'https://timeout.example.com' } } } },
        { mode: 'merge' },
      )

      expect(updated.content).toEqual({
        mcp: {
          timeout: { connect: 5000 },
          servers: { timeout: { type: 'remote', url: 'https://timeout.example.com' } },
        },
      })
    })

    it('keeps the v2 mcp servers when saving an MCP server named like the v2 servers map', async () => {
      await writeFile(
        sourcePath('opencode.json'),
        JSON.stringify({ mcp: { servers: { linear: { type: 'remote', url: 'https://linear.example.com' } } } }),
        'utf8',
      )

      const updated = await updateOpenCodeConfigFile(
        { mcp: { servers: { servers: { type: 'remote', url: 'https://s.example.com' } } } },
        { mode: 'merge' },
      )

      expect(updated.content).toEqual({
        mcp: {
          servers: {
            linear: { type: 'remote', url: 'https://linear.example.com' },
            servers: { type: 'remote', url: 'https://s.example.com' },
          },
        },
      })
    })

    it('keeps the v2 mcp object when the whole servers map is removed', async () => {
      await writeFile(
        sourcePath('opencode.json'),
        JSON.stringify({ mcp: { timeout: { connect: 5000 }, servers: { linear: { type: 'remote', url: 'https://linear.example.com' } } } }),
        'utf8',
      )

      const updated = await updateOpenCodeConfigFile({ mcp: { servers: null } }, { mode: 'merge' })

      expect(updated.content).toEqual({ mcp: { timeout: { connect: 5000 } } })
    })

    it('keeps a comment that leads the sibling after the removed v1 container', async () => {
      const raw = '{\n  // lead\n  "agent": {"reviewer":{"description":"Legacy reviewer"}},\n  // theme comment\n  "theme": "dark"\n}\n'
      await writeFile(sourcePath('opencode.json'), raw, 'utf8')

      const updated = await updateOpenCodeConfigFile(
        { agents: { reviewer: { description: 'New reviewer' } } },
        { mode: 'merge' },
      )

      expect(updated.content).toEqual({
        theme: 'dark',
        agents: { reviewer: { description: 'New reviewer' } },
      })
      const onDisk = await readFile(sourcePath('opencode.json'), 'utf8')
      expect(onDisk).toContain('// lead')
      expect(onDisk).toContain('// theme comment')
      expect(onDisk).not.toContain('"agent"')
    })

    it('keeps the following sibling comment when the v1 container has no leading comment', async () => {
      const raw = '{\n  "agent": {"reviewer":{"description":"Legacy reviewer"}},\n  // theme comment\n  "theme": "dark"\n}\n'
      await writeFile(sourcePath('opencode.json'), raw, 'utf8')

      await updateOpenCodeConfigFile({ agents: { reviewer: { description: 'New reviewer' } } }, { mode: 'merge' })

      const onDisk = await readFile(sourcePath('opencode.json'), 'utf8')
      expect(onDisk).toContain('// theme comment')
      expect(onDisk).not.toContain('"agent"')
    })

    it('keeps a comment that leads the next sibling inside the v1 container', async () => {
      const raw = [
        '{',
        '  "agent": {',
        '    "reviewer": { "description": "Legacy reviewer" }, // keep',
        '    "keeper": { "description": "Keeper" }',
        '  }',
        '}',
      ].join('\n')
      await writeFile(sourcePath('opencode.json'), raw, 'utf8')

      const updated = await updateOpenCodeConfigFile(
        { agents: { reviewer: { description: 'New reviewer' } } },
        { mode: 'merge' },
      )

      expect(updated.content).toEqual({
        agent: { keeper: { description: 'Keeper' } },
        agents: { reviewer: { description: 'New reviewer' } },
      })
      const onDisk = await readFile(sourcePath('opencode.json'), 'utf8')
      expect(onDisk).toContain('// keep')
      expect(onDisk).not.toContain('Legacy reviewer')
    })

    it('removes both definitions when the v2 entity is patched with null', async () => {
      const raw = JSON.stringify({
        agent: { reviewer: { description: 'Legacy reviewer' } },
        agents: { reviewer: { description: 'Current reviewer' } },
      }, null, 2)
      await writeFile(sourcePath('opencode.json'), raw, 'utf8')

      const updated = await updateOpenCodeConfigFile({ agents: { reviewer: null } }, { mode: 'merge' })

      expect(updated.content).toEqual({ agents: {} })
      const onDisk = JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')) as Record<string, unknown>
      expect(onDisk).toEqual({ agents: {} })
      expect(onDisk).not.toHaveProperty('agent')
    })

    it('keeps the v2 definition when the same entity exists in both shapes', async () => {
      const raw = JSON.stringify({
        agent: { reviewer: { description: 'Legacy reviewer' } },
        agents: { reviewer: { description: 'Current reviewer' } },
      }, null, 2)
      await writeFile(sourcePath('opencode.json'), raw, 'utf8')

      const updated = await updateOpenCodeConfigFile(
        { agents: { reviewer: { description: 'Current reviewer' } } },
        { mode: 'merge' },
      )

      expect(updated.content).toEqual({ agents: { reviewer: { description: 'Current reviewer' } } })
      const onDisk = await readFile(sourcePath('opencode.json'), 'utf8')
      expect(JSON.parse(onDisk)).toEqual({ agents: { reviewer: { description: 'Current reviewer' } } })
      expect(onDisk).not.toContain('Legacy reviewer')
    })

    it('keeps other v1 entities in the container', async () => {
      const raw = JSON.stringify({
        agent: {
          reviewer: { description: 'Legacy reviewer' },
          keeper: { description: 'Keeper' },
        },
      }, null, 2)
      await writeFile(sourcePath('opencode.json'), raw, 'utf8')

      const updated = await updateOpenCodeConfigFile(
        { agents: { reviewer: { description: 'New reviewer' } } },
        { mode: 'merge' },
      )

      expect(updated.content).toEqual({
        agent: { keeper: { description: 'Keeper' } },
        agents: { reviewer: { description: 'New reviewer' } },
      })
      const onDisk = JSON.parse(await readFile(sourcePath('opencode.json'), 'utf8')) as Record<string, unknown>
      expect(onDisk).toHaveProperty('agent.keeper')
    })

    it('rejects the save when the v1 entity only a lower-priority source defines', async () => {
      const lower = JSON.stringify({ agent: { reviewer: { description: 'Legacy reviewer' } } })
      const target = '{"theme":"dark"}'
      await writeFile(sourcePath('opencode.json'), lower, 'utf8')
      await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')

      const error = await updateOpenCodeConfigFile(
        { agents: { reviewer: { description: 'New reviewer' } } },
        { mode: 'merge' },
      ).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(OpenCodeConfigShadowedRemovalError)
      expect((error as OpenCodeConfigShadowedRemovalError).paths).toEqual(['agent.reviewer'])
      expect((error as OpenCodeConfigShadowedRemovalError).sources).toEqual(['opencode.json'])
      await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(target)
    })
  })

  describe('restoreLegacyOpenCodeConfigBackup', () => {
    const backupPath = (configPath: string) => `${configPath}.ocm-sandbox-backup`

    it('restores removed enforcement sections from a legacy backup and removes it', async () => {
      const configPath = sourcePath('opencode.json')
      await writeFile(configPath, JSON.stringify({ model: 'x' }), 'utf8')
      await writeFile(backupPath(configPath), JSON.stringify({ removedSections: { plugin: ['my-plugin'] } }), 'utf8')

      await restoreLegacyOpenCodeConfigBackup(configPath)

      await expect(readFile(configPath, 'utf8')).resolves.toBe(
        JSON.stringify({ model: 'x', plugin: ['my-plugin'] }, null, 2),
      )
      await expect(access(backupPath(configPath))).rejects.toThrow()
    })

    it('rejects a non-object current config without overwriting it and keeps the backup', async () => {
      const configPath = sourcePath('opencode.json')
      await writeFile(configPath, '[]', 'utf8')
      await writeFile(backupPath(configPath), JSON.stringify({ removedSections: { plugin: ['my-plugin'] } }), 'utf8')

      await expect(restoreLegacyOpenCodeConfigBackup(configPath)).rejects.toThrow(/is not an object/)

      await expect(readFile(configPath, 'utf8')).resolves.toBe('[]')
      await expect(access(backupPath(configPath))).resolves.toBeUndefined()
    })

    it('does not overwrite a config update queued on the same native directory lock', async () => {
      const nativeDir = path.join(workDir, 'native')
      const configPath = path.join(nativeDir, 'opencode.json')
      await mkdir(nativeDir, { recursive: true })
      await writeFile(configPath, JSON.stringify({ model: 'x' }), 'utf8')
      await writeFile(backupPath(configPath), JSON.stringify({ removedSections: { plugin: ['my-plugin'] } }), 'utf8')

      let releaseWrite!: () => void
      const writeBlocked = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      let enteredWrite!: () => void
      const writeEntered = new Promise<void>((resolve) => {
        enteredWrite = resolve
      })
      writeGate.beforeWrite = () => writeBlocked
      writeGate.entered = enteredWrite

      const restore = restoreLegacyOpenCodeConfigBackup(configPath)
      await writeEntered

      const update = withFileLock(nativeDir, async () => {
        await writeFile(configPath, JSON.stringify({ model: 'updated' }), 'utf8')
      })

      releaseWrite()
      await Promise.all([update, restore])

      await expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ model: 'updated' })
      await expect(access(backupPath(configPath))).rejects.toThrow()
    })
  })

  describe('foldLegacyConfigJsonSource', () => {
    const legacyPath = () => sourcePath(LEGACY_OPENCODE_CONFIG_SOURCE_NAME)

    it('promotes a lone legacy config.json to opencode.json and archives the original', async () => {
      const legacy = '{\n  // legacy config\n  "model": "a/b"\n}\n'
      await writeFile(legacyPath(), legacy, 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(true)

      await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(legacy)
      await expect(readFile(legacyPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readArchivedLegacyContents()).resolves.toEqual([legacy])
    })

    it('merges legacy keys under opencode.json without overriding existing keys or comments', async () => {
      const legacy = '{\n  // legacy config\n  "model": "a/b",\n  "theme": "light"\n}\n'
      const target = '{\n  // target config\n  "theme": "dark"\n}\n'
      await writeFile(legacyPath(), legacy, 'utf8')
      await writeFile(sourcePath('opencode.json'), target, 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(true)

      const merged = await readFile(sourcePath('opencode.json'), 'utf8')
      expect(merged).toContain('// target config')
      expect(merged).toContain('"theme": "dark"')
      expect(merged).toContain('"model": "a/b"')
      expect(merged).not.toContain('// legacy config')
      await expect(readFile(legacyPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readArchivedLegacyContents()).resolves.toEqual([legacy])
    })

    it('merges legacy keys under opencode.jsonc when opencode.json is absent', async () => {
      const legacy = '{"model":"a/b","theme":"light"}'
      const target = '{\n  // target config\n  "theme": "dark"\n}\n'
      await writeFile(legacyPath(), legacy, 'utf8')
      await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(true)

      const merged = await readFile(sourcePath('opencode.jsonc'), 'utf8')
      expect(merged).toContain('// target config')
      expect(merged).toContain('"theme": "dark"')
      expect(merged).toContain('"model": "a/b"')
      await expect(readFile(legacyPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(sourcePath('opencode.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readArchivedLegacyContents()).resolves.toEqual([legacy])
    })

    it('leaves a nested legacy key that the merge target already defines', async () => {
      const legacy = '{"provider":{"a":{"x":1,"y":2}}}'
      const target = '{"provider":{"a":{"x":9}}}'
      await writeFile(legacyPath(), legacy, 'utf8')
      await writeFile(sourcePath('opencode.json'), target, 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(true)

      const merged = await readOpenCodeConfigFile()
      expect(merged?.content).toEqual({ provider: { a: { x: 9, y: 2 } } })
    })

    it('is idempotent once the legacy source is folded', async () => {
      const legacy = '{"model":"a/b"}'
      await writeFile(legacyPath(), legacy, 'utf8')
      await writeFile(sourcePath('opencode.json'), '{"theme":"dark"}', 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(true)
      const merged = await readFile(sourcePath('opencode.json'), 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(false)
      await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(merged)
      await expect(readArchivedLegacyContents()).resolves.toEqual([legacy])
    })

    it('leaves an unparseable legacy config.json in place', async () => {
      await writeFile(legacyPath(), '{ not jsonc', 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(false)

      await expect(readFile(legacyPath(), 'utf8')).resolves.toBe('{ not jsonc')
      await expect(readdir(archiveDirectory())).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('leaves the legacy source in place when the merge target is invalid', async () => {
      const legacy = '{"model":"a/b"}'
      await writeFile(legacyPath(), legacy, 'utf8')
      await writeFile(sourcePath('opencode.json'), '{"model":123}', 'utf8')

      await expect(foldLegacyConfigJsonSource()).resolves.toBe(false)

      await expect(readFile(legacyPath(), 'utf8')).resolves.toBe(legacy)
      await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe('{"model":123}')
      await expect(readdir(archiveDirectory())).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('folds a restored legacy snapshot envelope containing config.json', async () => {
      const snapshot = JSON.stringify({
        version: 1,
        sources: [
          { name: 'opencode.json', rawContent: '{"theme":"dark"}' },
          { name: LEGACY_OPENCODE_CONFIG_SOURCE_NAME, rawContent: '{"model":"a/b"}' },
        ],
      })

      await restoreOpenCodeConfigSnapshot(snapshot)

      const restored = await readOpenCodeConfigFile()
      expect(restored?.content).toEqual({ theme: 'dark', model: 'a/b' })
      expect(restored?.sources.map((source) => source.name)).toEqual(['opencode.json'])
      await expect(readFile(legacyPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readArchivedLegacyContents()).resolves.toEqual(['{"model":"a/b"}'])
    })

    it('promotes a legacy snapshot that only contains config.json', async () => {
      const snapshot = JSON.stringify({
        version: 1,
        sources: [{ name: LEGACY_OPENCODE_CONFIG_SOURCE_NAME, rawContent: '{"model":"a/b"}' }],
      })

      await restoreOpenCodeConfigSnapshot(snapshot)

      const restored = await readOpenCodeConfigFile()
      expect(restored?.path).toBe(sourcePath('opencode.json'))
      expect(restored?.content).toEqual({ model: 'a/b' })
      await expect(readFile(legacyPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readArchivedLegacyContents()).resolves.toEqual(['{"model":"a/b"}'])
    })
  })
})
