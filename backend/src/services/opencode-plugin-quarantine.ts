import { promises as fs } from 'fs'
import { lstat, realpath } from 'fs/promises'
import path from 'path'
import { parseJsonc } from '@opencode-manager/shared/utils'
import { logger } from '../utils/logger'
import { mkdirSafe, writeFileAtomic } from '../utils/fs-safe'
import { getOpenCodePluginDir } from './opencode/plugin-registry'
import {
  isRecord,
  restoreEnforcementSections,
  type EnforcementRemovedSections,
} from './opencode/enforcement-config'

const PLUGIN_CONFIG_BACKUP_SUFFIX = '.ocm-sandbox-backup'
const QUARANTINE_CONFLICT_SUFFIX = '.ocm-conflict'
const QUARANTINE_MANIFEST_FILENAME = '.ocm-quarantine-manifest.json'

export function getOpenCodePluginDiscoveryHome(): string {
  return process.env.HOME ?? '/home/node'
}

type QuarantineManifestEntry = {
  original: string
  order: number
}

type QuarantineManifest = {
  version: 1
  entries: Record<string, QuarantineManifestEntry>
}

function getPluginDirs(configHome: string): string[] {
  const home = getOpenCodePluginDiscoveryHome()
  return [
    getOpenCodePluginDir(configHome),
    path.join(configHome, 'opencode', 'plugins'),
    path.join(home, '.opencode', 'plugin'),
    path.join(home, '.opencode', 'plugins'),
  ]
}

function getToolDirs(configHome: string): string[] {
  const home = getOpenCodePluginDiscoveryHome()
  return [
    path.join(configHome, 'opencode', 'tool'),
    path.join(configHome, 'opencode', 'tools'),
    path.join(home, '.opencode', 'tool'),
    path.join(home, '.opencode', 'tools'),
  ]
}

function getNativeOpenCodeConfigPaths(configHome: string): string[] {
  const home = getOpenCodePluginDiscoveryHome()
  return [
    path.join(configHome, 'opencode', 'opencode.json'),
    path.join(configHome, 'opencode', 'opencode.jsonc'),
    path.join(configHome, 'opencode', 'config.json'),
    path.join(home, '.opencode', 'opencode.json'),
    path.join(home, '.opencode', 'opencode.jsonc'),
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
    ['opencode.json', 'opencode.jsonc'].map((file) => path.join(dir, file)),
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
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
    if (errorCode === 'ENOENT') return false
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
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
    if (errorCode === 'ENOENT') return { version: 1, entries: {} }
    throw new Error(`cannot read quarantine manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`quarantine manifest ${manifestPath} is not valid JSON`)
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as { version?: unknown; entries?: unknown }
    if (record.version === 1 && record.entries && typeof record.entries === 'object' && !Array.isArray(record.entries)) {
      return { version: 1, entries: record.entries as Record<string, QuarantineManifestEntry> }
    }
  }
  throw new Error(`quarantine manifest ${manifestPath} is malformed`)
}

async function restorePluginEntries(dir: string): Promise<void> {
  const quarantineDir = `${dir}.ocm-quarantine`
  if (!(await requireRealDirectory(quarantineDir, 'quarantine directory'))) return
  let entries: string[]
  try {
    entries = await fs.readdir(quarantineDir)
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
    if (errorCode === 'ENOENT') return
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
    const record = manifest.entries[stored]
    if (
      record &&
      isSingleBasenameComponent(stored) &&
      typeof record.original === 'string' &&
      isSingleBasenameComponent(record.original) &&
      typeof record.order === 'number' &&
      Number.isFinite(record.order)
    ) {
      const list = byOriginal.get(record.original) ?? []
      list.push({ stored, order: record.order })
      byOriginal.set(record.original, list)
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

async function existingFileMode(filePath: string): Promise<number | undefined> {
  try {
    return (await fs.stat(filePath)).mode & 0o777
  } catch {
    return undefined
  }
}

async function restoreEnforcementConfigSections(configPath: string): Promise<void> {
  const backupPath = `${configPath}${PLUGIN_CONFIG_BACKUP_SUFFIX}`
  if (!(await pathExists(backupPath))) return

  let backupContent: string
  try {
    backupContent = await fs.readFile(backupPath, 'utf-8')
  } catch (error) {
    throw new Error(`cannot read legacy backup ${backupPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let currentContent: string
  try {
    currentContent = await fs.readFile(configPath, 'utf-8')
  } catch (error) {
    throw new Error(`cannot read config ${configPath} while restoring legacy backup: ${error instanceof Error ? error.message : String(error)}`)
  }

  let backupRecord: Record<string, unknown>
  try {
    backupRecord = parseJsonc(backupContent) as Record<string, unknown>
  } catch (error) {
    throw new Error(`cannot parse legacy backup ${backupPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(backupRecord)) {
    throw new Error(`legacy backup ${backupPath} is malformed`)
  }
  const removed: EnforcementRemovedSections = isRecord(backupRecord.removedSections)
    ? backupRecord.removedSections
    : {
      plugin: Array.isArray(backupRecord.originalPlugins)
        ? backupRecord.originalPlugins
        : Array.isArray(backupRecord.plugin) ? backupRecord.plugin : [],
    }
  let currentConfig: Record<string, unknown>
  try {
    currentConfig = parseJsonc(currentContent) as Record<string, unknown>
  } catch (error) {
    throw new Error(`cannot parse config ${configPath} while restoring legacy backup: ${error instanceof Error ? error.message : String(error)}`)
  }

  const restored = restoreEnforcementSections(currentConfig, removed)
  const restoredContent = JSON.stringify(restored, null, 2)
  if (restoredContent !== currentContent) {
    await writeFileAtomic(configPath, restoredContent, { mode: await existingFileMode(configPath) })
  }
  await fs.rm(backupPath, { force: true })
}

export async function restoreQuarantinedOpenCodePlugins(configHome: string, configPath: string): Promise<void> {
  for (const dir of getPluginDirs(configHome)) {
    await restorePluginEntries(dir)
  }
  for (const dir of getToolDirs(configHome)) {
    await restorePluginEntries(dir)
  }
  for (const nativeConfigPath of getEnforcementConfigPaths(configHome, configPath)) {
    await restoreEnforcementConfigSections(nativeConfigPath)
  }
}
