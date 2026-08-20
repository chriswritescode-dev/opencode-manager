import { promises as fs } from 'fs'
import { lstat, realpath } from 'fs/promises'
import path from 'path'
import { parseJsonc } from '@opencode-manager/shared/utils'
import { logger } from '../utils/logger'
import { mkdirSafe, writeFileAtomic } from '../utils/fs-safe'
import { getOpenCodePluginDir, TRUSTED_OPENCODE_PLUGIN_FILENAMES } from './opencode/plugin-registry'
import {
  isRecord,
  restoreEnforcementSections,
  sanitizeEnforcementSections,
  type EnforcementRemovedSections,
} from './opencode/enforcement-config'

const TRUSTED_TOOL_FILENAMES: readonly string[] = []
const PLUGIN_CONFIG_BACKUP_SUFFIX = '.ocm-sandbox-backup'
const QUARANTINE_CONFLICT_SUFFIX = '.ocm-conflict'
const QUARANTINE_MANIFEST_FILENAME = '.ocm-quarantine-manifest.json'

export function getOpenCodePluginDiscoveryHome(): string {
  return process.env.HOME ?? '/home/node'
}

type PluginConfigBackup = {
  originalPlugins?: unknown
  sanitizedConfig?: Record<string, unknown>
  plugin?: unknown
  removedSections?: EnforcementRemovedSections
}

type QuarantineManifestEntry = {
  original: string
  order: number
}

type QuarantineManifest = {
  version: 1
  entries: Record<string, QuarantineManifestEntry>
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    return left.every((value, index) => deepEqual(value, right[index]))
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord).sort()
    const rightKeys = Object.keys(rightRecord).sort()
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]))
  }
  return false
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

function getAuthFilePath(configHome: string): string {
  return path.join(path.dirname(configHome), '.opencode', 'state', 'opencode', 'auth.json')
}

async function assertNoWellKnownAuthEntries(configHome: string): Promise<void> {
  const authPath = getAuthFilePath(configHome)
  let content: string
  try {
    content = await fs.readFile(authPath, 'utf-8')
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
    if (errorCode === 'ENOENT') return
    throw new Error(
      `cannot inspect OpenCode auth file ${authPath}: ${error instanceof Error ? error.message : String(error)}; refusing to start an enforced server with an uninspectable auth file`,
    )
  }
  let auth: unknown
  try {
    auth = JSON.parse(content)
  } catch (error) {
    throw new Error(
      `cannot parse OpenCode auth file ${authPath}: ${error instanceof Error ? error.message : String(error)}; refusing to start an enforced server with an uninspectable auth file`,
    )
  }
  if (!isRecord(auth)) {
    throw new Error(
      `OpenCode auth file ${authPath} has an unexpected top-level shape; refusing to start an enforced server with an uninspectable auth file`,
    )
  }
  for (const [providerId, entry] of Object.entries(auth)) {
    if (!isRecord(entry)) {
      throw new Error(
        `OpenCode auth entry ${providerId} in ${authPath} cannot be inspected; refusing to start an enforced server with an uninspectable auth file`,
      )
    }
    if (entry.type === 'wellknown') {
      throw new Error(
        `refusing to start an enforced OpenCode server: provider ${providerId} authenticates through well-known remote configuration (.well-known/opencode) that the Manager cannot sanitize; remove the provider authentication or disable sandboxing`,
      )
    }
  }
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
    throw new Error(`${purpose} ${dir} is a symbolic link; refusing to quarantine or restore through a redirected directory`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`${purpose} ${dir} is not a directory; refusing to quarantine or restore through it`)
  }
  const resolved = path.resolve(dir)
  const canonicalParent = await realpath(path.dirname(resolved))
  const canonical = await realpath(resolved)
  if (canonical !== path.join(canonicalParent, path.basename(resolved))) {
    throw new Error(`${purpose} ${dir} resolves to ${canonical} instead of ${resolved}; refusing to quarantine or restore through a redirected directory`)
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

async function resolveQuarantineTarget(quarantineDir: string, name: string): Promise<string> {
  const stored = name === QUARANTINE_MANIFEST_FILENAME
    ? `${name}${QUARANTINE_CONFLICT_SUFFIX}1`
    : name
  const original = path.join(quarantineDir, stored)
  if (!(await pathExists(original))) return original
  for (let index = 1; ; index++) {
    const candidate = path.join(quarantineDir, `${stored}${QUARANTINE_CONFLICT_SUFFIX}${index}`)
    if (!(await pathExists(candidate))) return candidate
  }
}

async function readQuarantineManifest(quarantineDir: string): Promise<QuarantineManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(quarantineDir, QUARANTINE_MANIFEST_FILENAME), 'utf-8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as { version?: unknown; entries?: unknown }
      if (record.version === 1 && record.entries && typeof record.entries === 'object' && !Array.isArray(record.entries)) {
        return { version: 1, entries: record.entries as Record<string, QuarantineManifestEntry> }
      }
    }
  } catch {
    // no manifest yet
  }
  return { version: 1, entries: {} }
}

async function writeQuarantineManifest(quarantineDir: string, manifest: QuarantineManifest): Promise<void> {
  await writeFileAtomic(path.join(quarantineDir, QUARANTINE_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2))
}

async function recordQuarantinedEntry(
  manifest: QuarantineManifest,
  storedName: string,
  originalName: string,
): Promise<void> {
  const existingOrders = Object.values(manifest.entries)
    .filter((record) => record.original === originalName)
    .map((record) => record.order)
  const order = storedName === originalName ? 1 : (existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1)
  manifest.entries[storedName] = { original: originalName, order }
}

async function moveUntrustedPluginEntries(
  dir: string,
  trustedNames: readonly string[],
  purpose = 'plugin directory',
): Promise<void> {
  if (!(await requireRealDirectory(dir, purpose))) return

  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
    if (errorCode === 'ENOENT') return
    throw new Error(`cannot inspect plugin directory ${dir}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const untrusted = entries.filter((name) => !trustedNames.includes(name))
  if (untrusted.length === 0) return

  const quarantineDir = `${dir}.ocm-quarantine`
  await mkdirSafe(quarantineDir)
  if (!(await requireRealDirectory(quarantineDir, 'quarantine directory'))) {
    throw new Error(`cannot create quarantine directory ${quarantineDir}`)
  }
  const manifest = await readQuarantineManifest(quarantineDir)
  for (const name of untrusted) {
    const source = path.join(dir, name)
    const target = await resolveQuarantineTarget(quarantineDir, name)
    await fs.rename(source, target)
    await recordQuarantinedEntry(manifest, path.basename(target), name)
  }
  await writeQuarantineManifest(quarantineDir, manifest)
  logger.warn(`Quarantined ${untrusted.length} untrusted OpenCode plugin file(s) from ${dir}`)
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

async function readPluginConfigBackup(backupPath: string): Promise<PluginConfigBackup | null> {
  try {
    const parsed = parseJsonc(await fs.readFile(backupPath, 'utf-8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PluginConfigBackup
    }
  } catch {
    return null
  }
  return null
}

function backupRemovedSections(backup: PluginConfigBackup | null): EnforcementRemovedSections {
  if (backup !== null && backup.removedSections !== undefined && isRecord(backup.removedSections)) {
    return backup.removedSections as EnforcementRemovedSections
  }
  const legacyPlugins = backup !== null && Array.isArray(backup.originalPlugins)
    ? backup.originalPlugins
    : backup?.plugin
  return Array.isArray(legacyPlugins) ? { plugin: legacyPlugins } : {}
}

async function existingFileMode(filePath: string): Promise<number | undefined> {
  try {
    return (await fs.stat(filePath)).mode & 0o777
  } catch {
    return undefined
  }
}

function describeRemovedSections(removed: EnforcementRemovedSections): string {
  const parts: string[] = []
  if (Array.isArray(removed.plugin) && removed.plugin.length > 0) {
    parts.push(`${removed.plugin.length} configured OpenCode plugin(s)`)
  }
  if (isRecord(removed.mcp) && Object.keys(removed.mcp).length > 0) {
    parts.push(`${Object.keys(removed.mcp).length} local MCP server(s)`)
  }
  if (isRecord(removed.provider) && Object.keys(removed.provider).length > 0) {
    parts.push(`${Object.keys(removed.provider).length} custom provider module(s)`)
  }
  if (removed.formatter !== undefined) {
    parts.push('the formatter configuration')
  }
  if (removed.shell !== undefined) {
    parts.push('the shell configuration')
  }
  if (removed.lsp !== undefined) {
    parts.push('the LSP server configuration')
  }
  if (removed.experimentalHook !== undefined) {
    parts.push('experimental hook commands')
  }
  return parts.length > 0 ? parts.join(', ') : 'all host-execution config sections'
}

function reconcileRemovedSections(
  prior: EnforcementRemovedSections,
  current: EnforcementRemovedSections,
): EnforcementRemovedSections {
  const merged: EnforcementRemovedSections = {}

  if (current.plugin !== undefined) {
    merged.plugin = current.plugin
  } else if (Array.isArray(prior.plugin) && prior.plugin.length > 0) {
    merged.plugin = prior.plugin
  }

  const priorMcp = isRecord(prior.mcp) ? prior.mcp : {}
  const currentMcp = isRecord(current.mcp) ? current.mcp : {}
  const mergedMcp: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(priorMcp)) {
    if (!(name in currentMcp)) {
      mergedMcp[name] = entry
    }
  }
  for (const [name, entry] of Object.entries(currentMcp)) {
    mergedMcp[name] = entry
  }
  if (Object.keys(mergedMcp).length > 0) {
    merged.mcp = mergedMcp
  }

  const priorProvider = isRecord(prior.provider) ? prior.provider : {}
  const currentProvider = isRecord(current.provider) ? current.provider : {}
  const mergedProvider: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(priorProvider)) {
    if (!(name in currentProvider)) {
      mergedProvider[name] = entry
    }
  }
  for (const [name, entry] of Object.entries(currentProvider)) {
    mergedProvider[name] = entry
  }
  if (Object.keys(mergedProvider).length > 0) {
    merged.provider = mergedProvider
  }

  for (const key of ['formatter', 'shell', 'lsp', 'experimentalHook'] as const) {
    if (current[key] !== undefined) {
      merged[key] = current[key]
    } else if (prior[key] !== undefined) {
      merged[key] = prior[key]
    }
  }

  return merged
}

async function sanitizeEnforcementConfigSections(configPath: string): Promise<void> {
  let content: string
  try {
    content = await fs.readFile(configPath, 'utf-8')
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
    if (errorCode === 'ENOENT') return
    throw error
  }

  let config: Record<string, unknown>
  try {
    config = parseJsonc(content) as Record<string, unknown>
  } catch (error) {
    throw new Error(`cannot parse OpenCode config ${configPath} for enforcement sanitization: ${error instanceof Error ? error.message : String(error)}`)
  }
  const backupPath = `${configPath}${PLUGIN_CONFIG_BACKUP_SUFFIX}`
  const hasBackup = await pathExists(backupPath)
  const pluginArray = Array.isArray(config.plugin) ? config.plugin : []
  const { sanitized, removed } = sanitizeEnforcementSections(config)
  if (
    !hasBackup &&
    pluginArray.length === 0 &&
    removed.mcp === undefined &&
    removed.formatter === undefined &&
    removed.shell === undefined &&
    removed.lsp === undefined &&
    removed.experimentalHook === undefined &&
    removed.provider === undefined
  ) {
    return
  }

  let effectiveRemoved = removed
  if (hasBackup) {
    const backup = await readPluginConfigBackup(backupPath)
    if (backup !== null) {
      const priorRemoved = backupRemovedSections(backup)
      if (backup.sanitizedConfig !== undefined && deepEqual(backup.sanitizedConfig, config)) {
        effectiveRemoved = priorRemoved
      } else {
        effectiveRemoved = reconcileRemovedSections(priorRemoved, removed)
      }
    }
  }

  const backupContent = JSON.stringify(
    {
      originalPlugins: effectiveRemoved.plugin,
      sanitizedConfig: sanitized,
      removedSections: effectiveRemoved,
    },
    null,
    2,
  )
  await writeFileAtomic(backupPath, backupContent, { mode: await existingFileMode(backupPath) })
  await writeFileAtomic(configPath, JSON.stringify(sanitized, null, 2), { mode: await existingFileMode(configPath) })
  logger.warn(`Removed ${describeRemovedSections(effectiveRemoved)} from ${configPath} while sandbox enforcement is active`)
}

async function restoreEnforcementConfigSections(configPath: string): Promise<void> {
  const backupPath = `${configPath}${PLUGIN_CONFIG_BACKUP_SUFFIX}`
  if (!(await pathExists(backupPath))) return

  let backupContent: string
  let currentContent: string
  try {
    backupContent = await fs.readFile(backupPath, 'utf-8')
    currentContent = await fs.readFile(configPath, 'utf-8')
  } catch {
    return
  }

  let removed: EnforcementRemovedSections
  let currentConfig: Record<string, unknown>
  try {
    const backupRecord = parseJsonc(backupContent) as Record<string, unknown>
    removed = isRecord(backupRecord.removedSections)
      ? backupRecord.removedSections
      : {
        plugin: Array.isArray(backupRecord.originalPlugins)
          ? backupRecord.originalPlugins
          : Array.isArray(backupRecord.plugin) ? backupRecord.plugin : [],
      }
    currentConfig = parseJsonc(currentContent) as Record<string, unknown>
  } catch {
    return
  }

  const restored = restoreEnforcementSections(currentConfig, removed)
  const restoredContent = JSON.stringify(restored, null, 2)
  if (restoredContent !== currentContent) {
    await writeFileAtomic(configPath, restoredContent, { mode: await existingFileMode(configPath) })
  }
  await fs.rm(backupPath, { force: true })
}

export async function quarantineOpenCodePlugins(configHome: string, configPath: string): Promise<void> {
  await assertNoWellKnownAuthEntries(configHome)
  const managerPluginDir = getOpenCodePluginDir(configHome)
  for (const dir of getPluginDirs(configHome)) {
    await moveUntrustedPluginEntries(dir, dir === managerPluginDir ? TRUSTED_OPENCODE_PLUGIN_FILENAMES : [])
  }
  for (const dir of getToolDirs(configHome)) {
    await moveUntrustedPluginEntries(dir, TRUSTED_TOOL_FILENAMES, 'custom tool directory')
  }
  for (const nativeConfigPath of getEnforcementConfigPaths(configHome, configPath)) {
    await sanitizeEnforcementConfigSections(nativeConfigPath)
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
    await restoreEnforcementConfigSections(nativeConfigPath)
  }
}
