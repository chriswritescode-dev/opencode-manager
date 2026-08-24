import path from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import type { Database } from 'bun:sqlite'
import { FILE_LIMITS, getConfigPath } from '@opencode-manager/shared/config/env'
import {
  OPENCODE_CANONICAL_CONFIG_FILENAME,
  getCommonUploadRootDirectory,
  isExcludedOpenCodeConfigUploadPath,
  isOpenCodeConfigUploadPath,
} from '@opencode-manager/shared/utils'
import { fileExists, normalizeUploadRelativePath, resolveWithinDirectory } from './file-operations'
import { mkdirSafe } from '../utils/fs-safe'
import { SettingsService } from './settings'
import { logger } from '../utils/logger'

export interface UploadedConfigDirectoryFile {
  relativePath: string
  content: Buffer
}

export interface ReplaceOpenCodeConfigDirectoryResult {
  configDirectory: string
  configSourceFilename: string
  filesInstalled: string[]
  skippedPaths: string[]
  preservedEntries: string[]
  executablesRestored: string[]
}

const MAX_CONFIG_DIRECTORY_FILES = 5000
const PRESERVED_ENTRIES = ['node_modules']
const STAGING_PREFIX = '.opencode-config-staging-'
const BACKUP_PREFIX = '.opencode-config-backup-'
const SHEBANG_PREFIX = '#!'

export async function replaceOpenCodeConfigDirectory(
  db: Database,
  files: UploadedConfigDirectoryFile[],
  userId = 'default',
): Promise<ReplaceOpenCodeConfigDirectoryResult> {
  const normalizedFiles = files.map((file) => ({
    relativePath: normalizeUploadRelativePath(file.relativePath, { collapseEmptySegments: true }),
    content: file.content,
  }))

  const commonRoot = getCommonUploadRootDirectory(normalizedFiles.map((file) => file.relativePath))
  const strippedFiles = normalizedFiles
    .map((file) => ({
      relativePath: commonRoot ? file.relativePath.slice(commonRoot.length + 1) : file.relativePath,
      content: file.content,
    }))
    .filter((file) => file.relativePath !== '')

  const kept: UploadedConfigDirectoryFile[] = []
  const skippedPaths: string[] = []
  for (const file of strippedFiles) {
    if (isExcludedOpenCodeConfigUploadPath(file.relativePath)) {
      skippedPaths.push(file.relativePath)
    } else {
      kept.push(file)
    }
  }

  if (kept.length === 0) {
    throw new Error('No files were provided for the OpenCode config directory replace')
  }
  if (kept.length > MAX_CONFIG_DIRECTORY_FILES) {
    throw new Error('Uploaded config directory contains too many files (max 5000)')
  }
  const totalBytes = kept.reduce((sum, file) => sum + file.content.length, 0)
  if (totalBytes > FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('Uploaded config directory files exceed maximum upload size')
  }

  const configCandidates = kept
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => isOpenCodeConfigUploadPath(file.relativePath))
  const jsonCandidate = configCandidates.find(({ file }) => file.relativePath === 'opencode.json')
  const jsoncCandidate = configCandidates.find(({ file }) => file.relativePath === 'opencode.jsonc')
  const chosenConfig = jsonCandidate ?? jsoncCandidate
  if (!chosenConfig) {
    throw new Error('Uploaded directory must contain opencode.json or opencode.jsonc at its root')
  }

  const configSourceFilename = chosenConfig.file.relativePath
  const droppedJsoncFile = jsonCandidate && jsoncCandidate ? jsoncCandidate.file : undefined
  if (droppedJsoncFile) {
    skippedPaths.push(droppedJsoncFile.relativePath)
  }

  new SettingsService(db).upsertDefaultOpenCodeConfig(chosenConfig.file.content.toString('utf8'), userId)

  const filesToWrite = kept
    .filter((file) => file !== droppedJsoncFile)
    .map((file) => file.relativePath === configSourceFilename
      ? { relativePath: OPENCODE_CANONICAL_CONFIG_FILENAME, content: file.content }
      : file)

  const configDirectory = getConfigPath()
  const parent = path.dirname(configDirectory)

  const executablesRestored: string[] = []
  const preservedEntries: string[] = []
  let staged: string | null = null
  let backupPath: string | null = null

  try {
    await mkdirSafe(parent)
    staged = await fs.mkdtemp(path.join(parent, STAGING_PREFIX))

    for (const file of filesToWrite) {
      const target = resolveWithinDirectory(staged, file.relativePath, 'config directory')
      await mkdirSafe(path.dirname(target))
      await fs.writeFile(target, file.content)
      if (file.content.subarray(0, SHEBANG_PREFIX.length).toString() === SHEBANG_PREFIX) {
        await fs.chmod(target, 0o755)
        executablesRestored.push(file.relativePath)
      }
    }

    if (await fileExists(configDirectory)) {
      backupPath = path.join(parent, BACKUP_PREFIX + randomUUID())
      await fs.rename(configDirectory, backupPath)
      await fs.rename(staged, configDirectory)
      staged = null

      for (const name of PRESERVED_ENTRIES) {
        const backupEntryPath = path.join(backupPath, name)
        const targetEntryPath = path.join(configDirectory, name)
        if (await fileExists(backupEntryPath) && !(await fileExists(targetEntryPath))) {
          await fs.rename(backupEntryPath, targetEntryPath)
          preservedEntries.push(name)
        }
      }
    } else {
      await fs.rename(staged, configDirectory)
      staged = null
    }

    if (backupPath) {
      await fs.rm(backupPath, { recursive: true, force: true })
    }

    logger.info(`Replaced OpenCode config directory at ${configDirectory}`)

    return {
      configDirectory,
      configSourceFilename,
      filesInstalled: filesToWrite.map((file) => file.relativePath),
      skippedPaths,
      preservedEntries,
      executablesRestored,
    }
  } catch (error) {
    if (staged) {
      await fs.rm(staged, { recursive: true, force: true })
    }
    if (backupPath) {
      if (await fileExists(configDirectory)) {
        await fs.rm(backupPath, { recursive: true, force: true })
      } else {
        await fs.rename(backupPath, configDirectory)
      }
    }
    throw error
  }
}
