import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { ZodError } from 'zod'

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
      if (writeFailures.paths.includes(filePath)) {
        throw new Error(`simulated write failure for ${filePath}`)
      }
      return actual.writeFileAtomic(filePath, content, options)
    }),
  }
})

import {
  HEALTH_WATCH_MAX_ENTRIES,
  LEGACY_OPENCODE_CONFIG_SOURCE_NAME,
  OPENCODE_CONFIG_SEED,
  OpenCodeConfigConflictError,
  OpenCodeConfigShadowedRemovalError,
  OpenCodeConfigSnapshotError,
  archiveBrokenOpenCodeConfigFile,
  deleteOpenCodeConfigFile,
  foldLegacyConfigJsonSource,
  pruneHealthWatchDirectory,
  readOpenCodeConfigFile,
  readOpenCodeConfigSnapshot,
  restoreOpenCodeConfigSnapshot,
  serializeOpenCodeConfigSnapshot,
  toOpenCodeConfigValidationIssues,
  updateOpenCodeConfigFile,
  writeHealthWatchArtifact,
  writeOpenCodeConfigFile,
} from '../../src/services/opencode-config-file'

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

  it('rejects invalid content with a ZodError and leaves the previous file untouched', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    await expect(writeOpenCodeConfigFile('{"model": 5}')).rejects.toBeInstanceOf(ZodError)
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

  it('maps Zod issues to config validation issues with a root fallback', () => {
    const issues = new ZodError([
      { code: 'custom', path: ['model'], message: 'Invalid model' },
      { code: 'custom', path: [], message: 'Invalid root' },
    ]).issues

    expect(toOpenCodeConfigValidationIssues(issues)).toEqual([
      { path: 'model', message: 'Invalid model' },
      { path: 'root', message: 'Invalid root' },
    ])
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

  it('removes an override from the target source only and reveals inherited values', async () => {
    const lower = JSON.stringify({ theme: 'light', model: 'a' })
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), '{\n  "theme": "dark"\n}\n', 'utf8')

    await updateOpenCodeConfigFile({ model: 'a' })

    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
    const revealed = await readOpenCodeConfigFile()
    expect(revealed?.content).toEqual({ theme: 'light', model: 'a' })
  })

  it('rejects a removal of a value that only a lower-priority source defines and writes nothing', async () => {
    const lower = '{\n  "theme": "light",\n  "model": "a"\n}\n'
    const target = '{\n  "model": "b"\n}\n'
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')
    const targetStats = await stat(sourcePath('opencode.jsonc'))

    const error = await updateOpenCodeConfigFile({ model: 'b' }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCodeConfigShadowedRemovalError)
    expect((error as OpenCodeConfigShadowedRemovalError).paths).toEqual(['theme'])
    expect((error as OpenCodeConfigShadowedRemovalError).sources).toEqual(['opencode.json'])
    await expect(readFile(sourcePath('opencode.jsonc'), 'utf8')).resolves.toBe(target)
    await expect(readFile(sourcePath('opencode.json'), 'utf8')).resolves.toBe(lower)
    expect((await stat(sourcePath('opencode.jsonc'))).mtimeMs).toBe(targetStats.mtimeMs)
  })

  it('rejects a mixed shadowed removal and legitimate change without writing anything', async () => {
    const lower = '{\n  "theme": "light",\n  "model": "a"\n}\n'
    const target = '{\n  "model": "b"\n}\n'
    await writeFile(sourcePath('opencode.json'), lower, 'utf8')
    await writeFile(sourcePath('opencode.jsonc'), target, 'utf8')

    const error = await updateOpenCodeConfigFile({ model: 'b', plugin: ['x'] }).catch((caught: unknown) => caught)

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
