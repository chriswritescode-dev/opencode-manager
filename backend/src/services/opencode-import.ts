import os from 'os'
import path from 'path'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir, rename, rm } from 'fs/promises'
import { Database as SQLiteDatabase } from 'bun:sqlite'
import { getConfigPath, getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  DEFAULT_OPENCODE_CONFIG_SOURCE_NAME,
  OPENCODE_CONFIG_SOURCE_NAMES,
  isOpenCodeConfigSourceName,
  selectPreferredOpenCodeConfigSourceName,
} from '@opencode-manager/shared'
import { parseOpenCodeConfigContent, restoreOpenCodeConfigSnapshot, serializeOpenCodeConfigSourceSnapshot, withOpenCodeConfigLock } from './opencode-config-file'
import { captureLastKnownGoodOpenCodeConfig } from './opencode-config-apply'
import { ensureDirectoryExists, fileExists, readFileContent } from './file-operations'
import type { SettingsService } from './settings'

const OPENCODE_STATE_DB_FILENAMES = new Set(['opencode.db', 'opencode.db-shm', 'opencode.db-wal'])

export interface OpenCodeImportStatus {
  configSourcePath: string | null
  configSourcePaths: string[]
  stateSourcePath: string | null
  workspaceConfigPath: string
  workspaceConfigPathsToRemove: string[]
  workspaceStatePath: string
  workspaceStateExists: boolean
}

export interface SyncOpenCodeImportOptions {
  overwriteState?: boolean
  protectExistingState?: boolean
  importConfig?: boolean
  status?: OpenCodeImportStatus
  settingsService?: SettingsService
}

export interface SyncOpenCodeImportResult extends OpenCodeImportStatus {
  configImported: boolean
  stateImported: boolean
}

export class OpenCodeImportProtectionError extends Error {
  code = 'OPENCODE_IMPORT_PROTECTED'
  detail: string

  constructor(detail: string) {
    super('OpenCode host import was blocked to protect existing workspace state')
    this.name = 'OpenCodeImportProtectionError'
    this.detail = detail
  }
}

export interface ImportedSessionDirectorySummary {
  directories: string[]
}

export function getImportPathCandidates(envKey: string, fallbackPath: string): string[] {
  const candidates = [process.env[envKey], fallbackPath]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(value))

  return Array.from(new Set(candidates))
}

function getExistingConfigSourcePaths(): string[] {
  const explicitPath = process.env.OPENCODE_IMPORT_CONFIG_PATH
  if (explicitPath && existsSync(path.resolve(explicitPath))) {
    return [path.resolve(explicitPath)]
  }
  return OPENCODE_CONFIG_SOURCE_NAMES
    .map(name => path.join(os.homedir(), '.config', 'opencode', name))
    .filter(candidate => existsSync(candidate))
}

async function getFirstExistingPathWithDatabase(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (await fileExists(candidate) && await fileExists(path.join(candidate, 'opencode.db'))) {
      return candidate
    }
  }

  return null
}

function escapeSqliteValue(value: string): string {
  return value.replace(/'/g, "''")
}

async function copyOpenCodeStateFiles(sourcePath: string, targetPath: string): Promise<void> {
  const entries = await readdir(sourcePath, { withFileTypes: true })

  for (const entry of entries) {
    if (OPENCODE_STATE_DB_FILENAMES.has(entry.name)) {
      continue
    }

    await cp(path.join(sourcePath, entry.name), path.join(targetPath, entry.name), {
      recursive: true,
      force: true,
      errorOnExist: false,
    })
  }
}

function snapshotOpenCodeDatabase(sourcePath: string, targetPath: string): void {
  const database = new SQLiteDatabase(sourcePath)

  try {
    database.exec(`VACUUM INTO '${escapeSqliteValue(targetPath)}'`)
  } finally {
    database.close()
  }
}

export async function importOpenCodeStateDirectory(sourcePath: string, targetPath: string): Promise<boolean> {
  const resolvedSourcePath = path.resolve(sourcePath)
  const resolvedTargetPath = path.resolve(targetPath)
  const sourceDbPath = path.join(resolvedSourcePath, 'opencode.db')
  const targetParentPath = path.dirname(resolvedTargetPath)
  const targetDirectoryName = path.basename(resolvedTargetPath)

  if (resolvedSourcePath === resolvedTargetPath) {
    return false
  }

  if (!await fileExists(sourceDbPath)) {
    return false
  }

  await ensureDirectoryExists(targetParentPath)

  const stagedTargetPath = await mkdtemp(path.join(targetParentPath, `${targetDirectoryName}-import-`))

  try {
    await copyOpenCodeStateFiles(resolvedSourcePath, stagedTargetPath)
    snapshotOpenCodeDatabase(sourceDbPath, path.join(stagedTargetPath, 'opencode.db'))

    await rm(resolvedTargetPath, { recursive: true, force: true })
    await rename(stagedTargetPath, resolvedTargetPath)
    return true
  } catch (error) {
    await rm(stagedTargetPath, { recursive: true, force: true })
    throw error
  }
}

export async function getOpenCodeImportStatus(): Promise<OpenCodeImportStatus> {
  const configDir = getConfigPath()
  const workspaceConfigNames = OPENCODE_CONFIG_SOURCE_NAMES.filter(name => existsSync(path.join(configDir, name)))
  const workspaceConfigPaths = workspaceConfigNames.map(name => path.join(configDir, name))
  const workspaceConfigPath = path.join(
    configDir,
    selectPreferredOpenCodeConfigSourceName(workspaceConfigNames) ?? DEFAULT_OPENCODE_CONFIG_SOURCE_NAME,
  )
  const workspaceStatePath = path.join(getWorkspacePath(), '.opencode', 'state', 'opencode')
  const workspaceStateExists = await fileExists(path.join(workspaceStatePath, 'opencode.db'))

  const configSourcePaths = getExistingConfigSourcePaths()
  const configSourcePath = configSourcePaths.at(-1) ?? null
  const hostSourceNames = new Set(configSourcePaths.map(sourcePath => path.basename(sourcePath)))
  const workspaceConfigPathsToRemove = configSourcePaths.length === 0
    ? []
    : workspaceConfigPaths.filter(workspaceSourcePath => !hostSourceNames.has(path.basename(workspaceSourcePath)))
  const stateSourcePath = await getFirstExistingPathWithDatabase(
    getImportPathCandidates('OPENCODE_IMPORT_STATE_PATH', path.join(os.homedir(), '.local', 'share', 'opencode'))
  )

  return {
    configSourcePath,
    configSourcePaths,
    stateSourcePath,
    workspaceConfigPath,
    workspaceConfigPathsToRemove,
    workspaceStatePath,
    workspaceStateExists,
  }
}

async function importOpenCodeConfigFromSources(sourcePaths: string[], settingsService?: SettingsService): Promise<boolean> {
  const configDir = getConfigPath()
  const sources = await Promise.all(sourcePaths.map(async sourcePath => {
    const basename = path.basename(sourcePath)
    const name = isOpenCodeConfigSourceName(basename) ? basename : DEFAULT_OPENCODE_CONFIG_SOURCE_NAME
    const rawContent = await readFileContent(sourcePath)
    if (!parseOpenCodeConfigContent(rawContent).isValid) {
      throw new Error('Importable OpenCode config is invalid')
    }
    return { name, path: path.join(configDir, name), rawContent }
  }))
  const selected = sources.at(-1)
  if (!selected) return false
  if (sources.every((source, index) => path.resolve(sourcePaths[index]!) === path.resolve(source.path))) return false
  const snapshot = serializeOpenCodeConfigSourceSnapshot(
    sources.map(source => ({ name: source.name, rawContent: source.rawContent })),
  )

  await withOpenCodeConfigLock(async () => {
    if (settingsService) {
      await captureLastKnownGoodOpenCodeConfig(settingsService)
    }
    await restoreOpenCodeConfigSnapshot(snapshot)
  })
  return true
}

export async function syncOpenCodeImport(options: SyncOpenCodeImportOptions): Promise<SyncOpenCodeImportResult> {
  const initialStatus = options.status ?? await getOpenCodeImportStatus()
  const overwriteState = options.overwriteState === true
  let configImported = false
  let stateImported = false

  if (options.protectExistingState && initialStatus.stateSourcePath && initialStatus.workspaceStateExists && !overwriteState) {
    throw new OpenCodeImportProtectionError(
      `Import was blocked because workspace state already exists at ${initialStatus.workspaceStatePath}. Clear the workspace state first if you want to replace it with host state.`
    )
  }

  if (options.importConfig !== false && initialStatus.configSourcePath) {
    configImported = await importOpenCodeConfigFromSources(initialStatus.configSourcePaths, options.settingsService)
  }

  if (initialStatus.stateSourcePath && (overwriteState || !initialStatus.workspaceStateExists)) {
    stateImported = await importOpenCodeStateDirectory(initialStatus.stateSourcePath, initialStatus.workspaceStatePath)
  }

  const finalStatus = await getOpenCodeImportStatus()

  return {
    ...finalStatus,
    configImported,
    stateImported,
  }
}

export async function getImportedSessionDirectories(workspaceStatePath?: string): Promise<ImportedSessionDirectorySummary> {
  const statePath = workspaceStatePath || path.join(getWorkspacePath(), '.opencode', 'state', 'opencode')
  const stateDbPath = path.join(statePath, 'opencode.db')

  if (!await fileExists(stateDbPath)) {
    return { directories: [] }
  }

  const database = new SQLiteDatabase(stateDbPath, { readonly: true })

  try {
    const rows = database
      .query("SELECT DISTINCT directory FROM session WHERE directory IS NOT NULL AND TRIM(directory) != '' ORDER BY directory")
      .all() as Array<{ directory: string }>

    return {
      directories: rows
        .map((row) => row.directory.trim())
        .filter(Boolean),
    }
  } finally {
    database.close()
  }
}
