import path from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import type { Database } from 'bun:sqlite'
import { FILE_LIMITS, getConfigPath } from '@opencode-manager/shared/config/env'
import {
  MAX_OPENCODE_CONFIG_DIRECTORY_FILES,
  OPENCODE_CANONICAL_CONFIG_FILENAME,
  OPENCODE_CONFIG_BACKUP_PREFIX,
  OPENCODE_CONFIG_STAGING_PREFIX,
  OPENCODE_CONFIG_UPLOAD_ERRORS,
  PRESERVED_OPENCODE_CONFIG_ENTRIES,
  getCommonUploadRootDirectory,
  isExcludedOpenCodeConfigUploadPath,
  isOpenCodeConfigUploadPath,
  stripUploadRootDirectory,
} from '@opencode-manager/shared/utils'
import type { ReplaceOpenCodeConfigDirectoryResult } from '@opencode-manager/shared/types'
import { fileExists, normalizeUploadRelativePath, resolveWithinDirectory } from './file-operations'
import { mkdirSafe } from '../utils/fs-safe'
import { SettingsService } from './settings'
import { logger } from '../utils/logger'

export interface UploadedConfigDirectoryFile {
  relativePath: string
  file: File
}

const SHEBANG_PREFIX = '#!'
const WRITE_BATCH_CONCURRENCY = 8

function readFileHead(file: File): Promise<string> {
  const slicable = file as unknown as { slice(start: number, end: number): { text(): Promise<string> } }
  return slicable.slice(0, SHEBANG_PREFIX.length).text()
}

export async function sweepStaleOpenCodeConfigDirectoryDirs(): Promise<void> {
  const parent = path.dirname(getConfigPath())
  let entries: string[]
  try {
    entries = await fs.readdir(parent)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith(OPENCODE_CONFIG_STAGING_PREFIX) || name.startsWith(OPENCODE_CONFIG_BACKUP_PREFIX)) {
      try {
        await fs.rm(path.join(parent, name), { recursive: true, force: true })
        logger.info(`Removed stale OpenCode config directory temp dir '${name}'`)
      } catch (error) {
        logger.warn(`Failed to remove stale OpenCode config directory temp dir '${name}'`, error)
      }
    }
  }
}

export async function replaceOpenCodeConfigDirectory(
  db: Database,
  files: UploadedConfigDirectoryFile[],
  userId = 'default',
): Promise<ReplaceOpenCodeConfigDirectoryResult> {
  const normalizedFiles = files.map((file) => ({
    relativePath: normalizeUploadRelativePath(file.relativePath, { collapseEmptySegments: true }),
    file: file.file,
  }))

  const kept: UploadedConfigDirectoryFile[] = []
  const skippedPaths: string[] = []
  for (const file of normalizedFiles) {
    if (isExcludedOpenCodeConfigUploadPath(file.relativePath)) {
      skippedPaths.push(file.relativePath)
    } else {
      kept.push(file)
    }
  }

  if (kept.length === 0) {
    throw new Error(OPENCODE_CONFIG_UPLOAD_ERRORS.NO_FILES_PROVIDED)
  }
  if (kept.length > MAX_OPENCODE_CONFIG_DIRECTORY_FILES) {
    throw new Error(OPENCODE_CONFIG_UPLOAD_ERRORS.TOO_MANY_FILES)
  }
  const totalBytes = kept.reduce((sum, file) => sum + file.file.size, 0)
  if (totalBytes > FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(OPENCODE_CONFIG_UPLOAD_ERRORS.EXCEEDS_MAX_UPLOAD_SIZE)
  }

  const commonRoot = getCommonUploadRootDirectory(kept.map((file) => file.relativePath))
  const strippedFiles = kept
    .map((file) => ({
      relativePath: stripUploadRootDirectory(file.relativePath, commonRoot),
      file: file.file,
    }))
    .filter((file) => file.relativePath !== '')

  const configCandidates = strippedFiles.filter((file) => isOpenCodeConfigUploadPath(file.relativePath))
  const jsonCandidate = configCandidates.find((file) => file.relativePath === 'opencode.json')
  const jsoncCandidate = configCandidates.find((file) => file.relativePath === 'opencode.jsonc')
  const chosenConfig = jsonCandidate ?? jsoncCandidate
  if (!chosenConfig) {
    throw new Error(OPENCODE_CONFIG_UPLOAD_ERRORS.MISSING_ROOT_CONFIG)
  }

  const configSourceFile = chosenConfig.file
  const configSourceFilename = chosenConfig.relativePath
  const droppedJsoncFile = jsonCandidate && jsoncCandidate ? jsoncCandidate : undefined
  if (droppedJsoncFile) {
    skippedPaths.push(droppedJsoncFile.relativePath)
  }

  const configSourceText = await configSourceFile.text()
  const settingsService = new SettingsService(db)
  settingsService.validateOpenCodeConfigContent(configSourceText)

  const filesToWrite = strippedFiles
    .filter((file) => file !== droppedJsoncFile)
    .map((file) => file.relativePath === configSourceFilename
      ? { relativePath: OPENCODE_CANONICAL_CONFIG_FILENAME, file: file.file }
      : file)

  const configDirectory = getConfigPath()
  const parent = path.dirname(configDirectory)

  const executablesRestored: string[] = []
  const preservedEntries: string[] = []
  let staged: string | null = null
  let backupPath: string | null = null
  let swapCompleted = false

  const buildResult = (): ReplaceOpenCodeConfigDirectoryResult => ({
    configSourceFilename,
    filesInstalled: filesToWrite.map((file) => file.relativePath),
    skippedPaths,
    preservedEntries,
    executablesRestored,
  })

  try {
    await mkdirSafe(parent)
    staged = await fs.mkdtemp(path.join(parent, OPENCODE_CONFIG_STAGING_PREFIX))
    const stagingDir = staged

    const createdDirectories = new Set<string>()
    for (let i = 0; i < filesToWrite.length; i += WRITE_BATCH_CONCURRENCY) {
      const batch = filesToWrite.slice(i, i + WRITE_BATCH_CONCURRENCY)
      await Promise.all(batch.map(async (file) => {
        const target = resolveWithinDirectory(stagingDir, file.relativePath, 'config directory')
        const targetDirectory = path.dirname(target)
        if (!createdDirectories.has(targetDirectory)) {
          createdDirectories.add(targetDirectory)
          await mkdirSafe(targetDirectory)
        }
        await Bun.write(target, file.file)
        if (await readFileHead(file.file) === SHEBANG_PREFIX) {
          await fs.chmod(target, 0o755)
          executablesRestored.push(file.relativePath)
        }
      }))
    }
    executablesRestored.sort()

    if (await fileExists(configDirectory)) {
      backupPath = path.join(parent, OPENCODE_CONFIG_BACKUP_PREFIX + randomUUID())
      await fs.rename(configDirectory, backupPath)
      await fs.rename(staged, configDirectory)
      staged = null
      swapCompleted = true

      for (const name of PRESERVED_OPENCODE_CONFIG_ENTRIES) {
        try {
          const backupEntryPath = path.join(backupPath, name)
          const targetEntryPath = path.join(configDirectory, name)
          if (await fileExists(backupEntryPath) && !(await fileExists(targetEntryPath))) {
            await fs.rename(backupEntryPath, targetEntryPath)
            preservedEntries.push(name)
          }
        } catch (error) {
          logger.warn(`Failed to preserve '${name}' after OpenCode config directory replace`, error)
        }
      }
    } else {
      await fs.rename(staged, configDirectory)
      staged = null
      swapCompleted = true
    }

    if (backupPath) {
      try {
        await fs.rm(backupPath, { recursive: true, force: true })
      } catch (error) {
        logger.warn(`Failed to remove OpenCode config directory backup at ${backupPath}`, error)
      }
    }

    settingsService.upsertDefaultOpenCodeConfig(configSourceText, userId)

    logger.info(`Replaced OpenCode config directory at ${configDirectory}`)

    return buildResult()
  } catch (error) {
    if (swapCompleted) {
      logger.warn('OpenCode config directory swap completed despite a post-swap error', error)
      return buildResult()
    }
    if (staged) {
      try {
        await fs.rm(staged, { recursive: true, force: true })
      } catch (cleanupError) {
        logger.warn('Failed to remove staging directory after failed replace', cleanupError)
      }
    }
    if (backupPath) {
      try {
        if (await fileExists(configDirectory)) {
          await fs.rm(backupPath, { recursive: true, force: true })
        } else {
          await fs.rename(backupPath, configDirectory)
        }
      } catch (cleanupError) {
        logger.warn('Failed to restore the previous config directory after failed replace', cleanupError)
      }
    }
    throw error
  }
}
