import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { ZodError } from 'zod'

const paths = vi.hoisted(() => ({ config: '', healthWatch: '' }))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getOpenCodeConfigFilePath: () => paths.config,
  getOpenCodeHealthWatchPath: () => paths.healthWatch,
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import {
  HEALTH_WATCH_MAX_ENTRIES,
  OPENCODE_CONFIG_SEED,
  archiveBrokenOpenCodeConfigFile,
  deleteOpenCodeConfigFile,
  pruneHealthWatchDirectory,
  readOpenCodeConfigFile,
  writeOpenCodeConfigFile,
} from '../../src/services/opencode-config-file'

describe('opencode-config-file', () => {
  let workDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    workDir = await mkdtemp(path.join(tmpdir(), 'opencode-config-file-'))
    paths.config = path.join(workDir, 'opencode.json')
    paths.healthWatch = path.join(workDir, 'health-watch')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('returns null when the config file does not exist', async () => {
    await expect(readOpenCodeConfigFile()).resolves.toBeNull()
  })

  it('writes a valid config and reads it back', async () => {
    const written = await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    expect(written.path).toBe(paths.config)
    expect(written.rawContent).toBe(OPENCODE_CONFIG_SEED)
    expect(written.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
    expect(written.isValid).toBe(true)
    expect(written.updatedAt).toBeGreaterThan(0)
  })

  it('preserves an existing non-default file mode when rewriting atomically', async () => {
    const previousUmask = process.umask(0)
    try {
      await writeFile(paths.config, OPENCODE_CONFIG_SEED, 'utf8')
      await chmod(paths.config, 0o640)

      await writeOpenCodeConfigFile('{"theme":"dark"}')

      const stats = await stat(paths.config)
      expect(stats.mode & 0o777).toBe(0o640)
    } finally {
      process.umask(previousUmask)
    }
  })

  it('rejects invalid content with a ZodError and leaves the previous file untouched', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    await expect(writeOpenCodeConfigFile('{"model": 5}')).rejects.toBeInstanceOf(ZodError)
    await expect(readFile(paths.config, 'utf8')).resolves.toBe(OPENCODE_CONFIG_SEED)
  })

  it('parses JSONC comments and preserves the raw content', async () => {
    const rawContent = '{\n  // user comment\n  "theme": "dark"\n}\n'
    await writeFile(paths.config, rawContent, 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.content).toEqual({ theme: 'dark' })
    expect(file?.rawContent).toBe(rawContent)
    expect(file?.isValid).toBe(true)
  })

  it('reports validation issues for schema-invalid content', async () => {
    await writeFile(paths.config, '{"model": 5}', 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.isValid).toBe(false)
    expect(file?.validationIssues?.[0]?.path).toBe('model')
  })

  it('reports a root validation issue when the file is not valid JSONC', async () => {
    await writeFile(paths.config, '{ not json', 'utf8')

    const file = await readOpenCodeConfigFile()

    expect(file?.isValid).toBe(false)
    expect(file?.validationIssues?.[0]?.path).toBe('root')
  })

  it('archives the config file under the health-watch directory', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    const archivePath = await archiveBrokenOpenCodeConfigFile()

    expect(archivePath).toBeTruthy()
    expect(path.dirname(archivePath as string)).toBe(paths.healthWatch)
    await expect(readFile(archivePath as string, 'utf8')).resolves.toBe(OPENCODE_CONFIG_SEED)
  })

  it('returns null when archiving with no config file present', async () => {
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

  it('deletes the config file and reports whether it existed', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    await expect(deleteOpenCodeConfigFile()).resolves.toBe(true)
    await expect(deleteOpenCodeConfigFile()).resolves.toBe(false)
  })
})
