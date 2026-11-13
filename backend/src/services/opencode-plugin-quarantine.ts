import { promises as fs } from 'fs'
import { lstat, realpath } from 'fs/promises'
import path from 'path'
import { OPENCODE_CONFIG_SOURCE_NAMES } from '@opencode-manager/shared'
import { logger } from '../utils/logger'
import { mkdirSafe } from '../utils/fs-safe'
import { z } from 'zod'
import { getErrorCode } from './error-code'
import { JsonValueSchema, type JsonValue } from '@opencode-manager/shared/utils'
import { restoreLegacyOpenCodeConfigBackup } from './opencode-config-file'
import { getOpenCodeHome } from './opencode-home'
import { getOpenCodePluginDir } from './opencode/plugin-registry'

const QUARANTINE_CONFLICT_SUFFIX = '.ocm-conflict'
const QUARANTINE_MANIFEST_FILENAME = '.ocm-quarantine-manifest.json'

const quarantineManifestEntrySchema = z.object({
  original: z.string(),
  order: z.number(),
})

const quarantineManifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), JsonValueSchema),
})

type QuarantineManifest = z.infer<typeof quarantineManifestSchema>

function getPluginDirs(configHome: string): string[] {
  const home = getOpenCodeHome()
  return [
    path.join(configHome, 'opencode', 'plugin'),
    getOpenCodePluginDir(configHome),
    path.join(home, '.opencode', 'plugin'),
    path.join(home, '.opencode', 'plugins'),
  ]
}

function getToolDirs(configHome: string): string[] {
  const home = getOpenCodeHome()
  return [
    path.join(configHome, 'opencode', 'tool'),
    path.join(configHome, 'opencode', 'tools'),
    path.join(home, '.opencode', 'tool'),
    path.join(home, '.opencode', 'tools'),
  ]
}

function getNativeOpenCodeConfigPaths(configHome: string): string[] {
  const home = getOpenCodeHome()
  return [
    ...OPENCODE_CONFIG_SOURCE_NAMES.map((name) => path.join(configHome, 'opencode', name)),
    ...OPENCODE_CONFIG_SOURCE_NAMES.map((name) => path.join(home, '.opencode', name)),
  ]
}

function getSystemManagedConfigDir(): string {
  switch (process.platform) {
    case 'darwin':
      return '/Library/Application Support/opencode'
    case 'win32':
      return path.join(process.env.ProgramData || 'C:\\ProgramData', 'opencode')
    default:
      return '/etc/opencode'
  }
}

function getManagedConfigPaths(): string[] {
  const dirs = [getSystemManagedConfigDir()]
  const override = process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
  if (override !== undefined && override.trim() !== '') {
    dirs.push(override)
  }
  return [...new Set(dirs)].flatMap((dir) =>
    OPENCODE_CONFIG_SOURCE_NAMES.map((file) => path.join(dir, file)),
  )
}

function getEnforcementConfigPaths(configHome: string, configPath: string): string[] {
  return [...new Set([configPath, ...getNativeOpenCodeConfigPaths(configHome), ...getManagedConfigPaths()])]
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function requireRealDirectory(dir: string, purpose: string): Promise<boolean> {
  let stat
  try {
    stat = await lstat(dir)
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return false
    throw new Error(`cannot inspect ${purpose} ${dir}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${purpose} ${dir} is a symbolic link; refusing to restore through a redirected directory`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`${purpose} ${dir} is not a directory; refusing to restore through it`)
  }
  const resolved = path.resolve(dir)
  const canonicalParent = await realpath(path.dirname(resolved))
  const canonical = await realpath(resolved)
  if (canonical !== path.join(canonicalParent, path.basename(resolved))) {
    throw new Error(`${purpose} ${dir} resolves to ${canonical} instead of ${resolved}; refusing to restore through a redirected directory`)
  }
  return true
}

function quarantineConflictSuffixMatch(name: string): string | null {
  const separatorIndex = name.lastIndexOf(QUARANTINE_CONFLICT_SUFFIX)
  if (separatorIndex === -1) return null
  const suffix = name.slice(separatorIndex + QUARANTINE_CONFLICT_SUFFIX.length)
  if (!/^\d+$/.test(suffix)) return null
  return name.slice(0, separatorIndex)
}

function isSingleBasenameComponent(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    path.basename(name) === name
  )
}

function assertPathContainedWithin(parent: string, child: string, purpose: string): string {
  const relative = path.relative(parent, child)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${purpose} path ${child} escapes ${parent}; refusing to restore outside the plugin directory`)
  }
  return path.join(parent, relative)
}

async function readQuarantineManifest(quarantineDir: string): Promise<QuarantineManifest> {
  const manifestPath = path.join(quarantineDir, QUARANTINE_MANIFEST_FILENAME)
  let content: string
  try {
    content = await fs.readFile(manifestPath, 'utf-8')
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return { version: 1, entries: {} }
    throw new Error(`cannot read quarantine manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed: JsonValue
  try {
    parsed = JsonValueSchema.parse(JSON.parse(content))
  } catch {
    throw new Error(`quarantine manifest ${manifestPath} is not valid JSON`)
  }
  const manifest = quarantineManifestSchema.safeParse(parsed)
  if (!manifest.success) {
    throw new Error(`quarantine manifest ${manifestPath} is malformed`)
  }
  return manifest.data
}

async function restorePluginEntries(dir: string): Promise<void> {
  const quarantineDir = `${dir}.ocm-quarantine`
  if (!(await requireRealDirectory(quarantineDir, 'quarantine directory'))) return
  let entries: string[]
  try {
    entries = await fs.readdir(quarantineDir)
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return
    throw error
  }

  await mkdirSafe(dir)
  if (!(await requireRealDirectory(dir, 'plugin directory'))) {
    throw new Error(`cannot create plugin directory ${dir}`)
  }

  const manifest = await readQuarantineManifest(quarantineDir)
  const storedNames = entries.filter((name) => name !== QUARANTINE_MANIFEST_FILENAME)

  const byOriginal = new Map<string, Array<{ stored: string; order: number }>>()
  const manifestless: string[] = []
  for (const stored of storedNames) {
    const record = quarantineManifestEntrySchema.safeParse(manifest.entries[stored])
    if (
      record.success &&
      isSingleBasenameComponent(stored) &&
      isSingleBasenameComponent(record.data.original)
    ) {
      const list = byOriginal.get(record.data.original) ?? []
      list.push({ stored, order: record.data.order })
      byOriginal.set(record.data.original, list)
    } else {
      manifestless.push(stored)
    }
  }

  for (const [original, copies] of byOriginal) {
    copies.sort((left, right) => left.order - right.order)
    const primary = copies[0]!
    const target = assertPathContainedWithin(dir, path.join(dir, original), 'restore target')
    if (await pathExists(target)) continue
    const source = assertPathContainedWithin(quarantineDir, path.join(quarantineDir, primary.stored), 'restore source')
    await fs.rename(source, target)
  }

  for (const name of manifestless) {
    const base = quarantineConflictSuffixMatch(name)
    if (base !== null) {
      const baseIsOriginal = manifest.entries[base] !== undefined || storedNames.includes(base)
      if (baseIsOriginal) continue
    }
    const target = assertPathContainedWithin(dir, path.join(dir, name), 'restore target')
    if (await pathExists(target)) continue
    const source = assertPathContainedWithin(quarantineDir, path.join(quarantineDir, name), 'restore source')
    await fs.rename(source, target)
  }

  await fs.rm(path.join(quarantineDir, QUARANTINE_MANIFEST_FILENAME), { force: true })

  const remaining = (await fs.readdir(quarantineDir)).filter((name) => name !== QUARANTINE_MANIFEST_FILENAME)
  if (remaining.length > 0) {
    logger.warn(
      `Left ${remaining.length} conflicted quarantined OpenCode plugin copy/copies recoverable in ${quarantineDir}: ${remaining.join(', ')}`,
    )
  }
}

export async function restoreQuarantinedOpenCodePlugins(configHome: string, configPath: string): Promise<void> {
  for (const dir of getPluginDirs(configHome)) {
    await restorePluginEntries(dir)
  }
  for (const dir of getToolDirs(configHome)) {
    await restorePluginEntries(dir)
  }
  for (const nativeConfigPath of getEnforcementConfigPaths(configHome, configPath)) {
    await restoreLegacyOpenCodeConfigBackup(nativeConfigPath)
  }
}
