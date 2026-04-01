import os from 'os'
import path from 'path'
import { cp, readdir, rm } from 'fs/promises'
import { Database as SQLiteDatabase, type Database } from 'bun:sqlite'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { getOpenCodeConfigFilePath, getWorkspacePath } from '@opencode-manager/shared/config/env'
import { parse as parseJsonc } from 'jsonc-parser'
import { SettingsService } from './settings'
import { ensureDirectoryExists, fileExists, readFileContent, writeFileContent } from './file-operations'

const OPENCODE_STATE_DB_FILENAMES = new Set(['opencode.db', 'opencode.db-shm', 'opencode.db-wal'])

export interface OpenCodeImportStatus {
  configSourcePath: string | null
  stateSourcePath: string | null
  workspaceConfigPath: string
  workspaceStatePath: string
  workspaceStateExists: boolean
}

export interface SyncOpenCodeImportOptions {
  db: Database
  userId?: string
  overwriteState?: boolean
}

export interface SyncOpenCodeImportResult extends OpenCodeImportStatus {
  configImported: boolean
  stateImported: boolean
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

export async function getFirstExistingPath(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (await fileExists(candidate)) {
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

export async function importOpenCodeStateDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDirectoryExists(targetPath)
  await copyOpenCodeStateFiles(sourcePath, targetPath)

  const sourceDbPath = path.join(sourcePath, 'opencode.db')
  if (!await fileExists(sourceDbPath)) {
    return
  }

  await rm(path.join(targetPath, 'opencode.db'), { force: true })
  await rm(path.join(targetPath, 'opencode.db-shm'), { force: true })
  await rm(path.join(targetPath, 'opencode.db-wal'), { force: true })
  snapshotOpenCodeDatabase(sourceDbPath, path.join(targetPath, 'opencode.db'))
}

export async function getOpenCodeImportStatus(): Promise<OpenCodeImportStatus> {
  const workspaceConfigPath = getOpenCodeConfigFilePath()
  const workspaceStatePath = path.join(getWorkspacePath(), '.opencode', 'state', 'opencode')
  const workspaceStateExists = await fileExists(path.join(workspaceStatePath, 'opencode.db'))

  const configSourcePath = await getFirstExistingPath(
    getImportPathCandidates('OPENCODE_IMPORT_CONFIG_PATH', path.join(os.homedir(), '.config', 'opencode', 'opencode.json'))
  )
  const stateSourcePath = await getFirstExistingPath(
    getImportPathCandidates('OPENCODE_IMPORT_STATE_PATH', path.join(os.homedir(), '.local', 'share', 'opencode'))
  )

  return {
    configSourcePath,
    stateSourcePath,
    workspaceConfigPath,
    workspaceStatePath,
    workspaceStateExists,
  }
}

async function importOpenCodeConfigFromSource(db: Database, userId: string, sourcePath: string, workspaceConfigPath: string): Promise<boolean> {
  const rawContent = await readFileContent(sourcePath)
  const parsed = parseJsonc(rawContent)
  const validation = OpenCodeConfigSchema.safeParse(parsed)

  if (!validation.success) {
    throw new Error('Importable OpenCode config is invalid')
  }

  const settingsService = new SettingsService(db)
  const existingDefault = settingsService.getOpenCodeConfigByName('default', userId)

  if (existingDefault) {
    settingsService.updateOpenCodeConfig('default', {
      content: rawContent,
      isDefault: true,
    }, userId)
  } else {
    settingsService.createOpenCodeConfig({
      name: 'default',
      content: rawContent,
      isDefault: true,
    }, userId)
  }

  await writeFileContent(workspaceConfigPath, rawContent)
  return true
}

export async function syncOpenCodeImport(options: SyncOpenCodeImportOptions): Promise<SyncOpenCodeImportResult> {
  const status = await getOpenCodeImportStatus()
  const userId = options.userId || 'default'
  let configImported = false
  let stateImported = false

  if (status.configSourcePath) {
    configImported = await importOpenCodeConfigFromSource(options.db, userId, status.configSourcePath, status.workspaceConfigPath)
  }

  if (status.stateSourcePath && ((options.overwriteState ?? true) || !status.workspaceStateExists)) {
    await importOpenCodeStateDirectory(status.stateSourcePath, status.workspaceStatePath)
    stateImported = true
  }

  return {
    ...status,
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
