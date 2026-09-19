import { readdir, rm, stat } from 'fs/promises'
import path from 'path'
import type { ZodIssue } from 'zod'
import { getOpenCodeConfigFilePath, getOpenCodeHealthWatchPath } from '@opencode-manager/shared/config/env'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { parseJsonc } from '@opencode-manager/shared/utils'
import type { OpenCodeConfigFile, OpenCodeConfigInput, OpenCodeConfigValidationIssue } from '../types/settings'
import { logger } from '../utils/logger'
import { withFileLock } from '../utils/atomic-json'
import { existingFileMode, writeFileAtomic } from '../utils/fs-safe'
import { ensureDirectoryExists, fileExists, readFileContent, writeFileContent } from './file-operations'

export const OPENCODE_CONFIG_SEED = JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)

export const HEALTH_WATCH_MAX_ENTRIES = 20

export function withOpenCodeConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(getOpenCodeConfigFilePath(), fn)
}

interface OpenCodeConfigParseResult {
  content: Record<string, unknown>
  isValid: boolean
  validationIssues?: OpenCodeConfigValidationIssue[]
}

export function normalizeOpenCodeConfigContent(content: OpenCodeConfigInput | string): string {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2)
}

export function toOpenCodeConfigValidationIssues(issues: ZodIssue[]): OpenCodeConfigValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
  }))
}

export function parseOpenCodeConfigContent(rawContent: string): OpenCodeConfigParseResult {
  let parsed: unknown
  try {
    parsed = parseJsonc(rawContent)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSONC'
    logger.error(`Failed to parse OpenCode config: ${message}`)
    return {
      content: {},
      isValid: false,
      validationIssues: [{ path: 'root', message }],
    }
  }

  const content = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}

  const validated = OpenCodeConfigSchema.safeParse(parsed)
  if (validated.success) {
    return {
      content: validated.data as Record<string, unknown>,
      isValid: true,
    }
  }

  const validationIssues = toOpenCodeConfigValidationIssues(validated.error.issues)
  logger.error(`Failed to validate OpenCode config: ${validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)

  return {
    content,
    isValid: false,
    validationIssues,
  }
}

export async function readOpenCodeConfigFile(): Promise<OpenCodeConfigFile | null> {
  const configPath = getOpenCodeConfigFilePath()

  let updatedAt: number
  try {
    const stats = await stat(configPath)
    updatedAt = stats.mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }

  const rawContent = await readFileContent(configPath)

  return {
    path: configPath,
    rawContent,
    ...parseOpenCodeConfigContent(rawContent),
    updatedAt,
  }
}

export async function writeOpenCodeConfigFile(rawContent: string): Promise<OpenCodeConfigFile> {
  const parsed = OpenCodeConfigSchema.parse(parseJsonc(rawContent))

  const configPath = getOpenCodeConfigFilePath()
  await writeFileAtomic(configPath, rawContent, { mode: await existingFileMode(configPath) })

  const stats = await stat(configPath)

  return {
    path: configPath,
    rawContent,
    content: parsed as Record<string, unknown>,
    isValid: true,
    updatedAt: stats.mtimeMs,
  }
}

export async function pruneHealthWatchDirectory(dirPath: string): Promise<void> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(dirPath, entry.name)
          const fileStats = await stat(filePath)
          return { filePath, mtimeMs: fileStats.mtimeMs }
        }),
    )

    if (files.length <= HEALTH_WATCH_MAX_ENTRIES) return

    files.sort((left, right) => right.mtimeMs - left.mtimeMs)
    await Promise.all(
      files.slice(HEALTH_WATCH_MAX_ENTRIES).map((file) => rm(file.filePath, { force: true })),
    )
  } catch (error) {
    logger.warn('Failed to prune OpenCode health-watch directory:', error)
  }
}

export async function writeHealthWatchArtifact(
  prefix: string,
  buildContent: (timestamp: string) => string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const artifactPath = path.join(getOpenCodeHealthWatchPath(), `${prefix}-${timestamp}.json`)
  await ensureDirectoryExists(getOpenCodeHealthWatchPath())
  await writeFileContent(artifactPath, buildContent(timestamp))
  await pruneHealthWatchDirectory(getOpenCodeHealthWatchPath())
  return artifactPath
}

export async function archiveBrokenOpenCodeConfigFile(): Promise<string | null> {
  const configPath = getOpenCodeConfigFilePath()
  if (!(await fileExists(configPath))) {
    return null
  }

  try {
    const content = await readFileContent(configPath)
    const archivePath = await writeHealthWatchArtifact('opencode-config-broken', () => content)
    logger.warn(`Archived broken OpenCode config to ${archivePath}`)
    return archivePath
  } catch (error) {
    logger.error('Failed to archive broken OpenCode config:', error)
    return null
  }
}

export async function deleteOpenCodeConfigFile(): Promise<boolean> {
  const configPath = getOpenCodeConfigFilePath()

  if (!(await fileExists(configPath))) {
    logger.warn('Config file does not exist:', configPath)
    return false
  }

  try {
    await rm(configPath, { force: true })
    logger.info('Deleted filesystem config to allow server startup:', configPath)
    return true
  } catch (error) {
    logger.error('Failed to delete config file:', error)
    return false
  }
}
