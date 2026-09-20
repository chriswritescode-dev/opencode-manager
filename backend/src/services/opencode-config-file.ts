import { createHash } from 'crypto'
import { readFile, readdir, rm, stat } from 'fs/promises'
import path from 'path'
import { isDeepStrictEqual } from 'node:util'
import { applyEdits, modify, type JSONPath } from 'jsonc-parser'
import type { ZodIssue } from 'zod'
import { getOpenCodeConfigFilePath, getOpenCodeHealthWatchPath, OPENCODE_CONFIG_FILENAMES } from '@opencode-manager/shared/config/env'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { parseJsonc } from '@opencode-manager/shared/utils'
import type {
  OpenCodeConfigFile,
  OpenCodeConfigSourceFile,
  OpenCodeConfigSourceName,
  OpenCodeConfigValidationIssue,
} from '../types/settings'
import { logger } from '../utils/logger'
import { withFileLock } from '../utils/atomic-json'
import { existingFileMode, writeFileAtomic } from '../utils/fs-safe'
import { ensureDirectoryExists } from './file-operations'

export const OPENCODE_CONFIG_SEED = JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)

export const HEALTH_WATCH_MAX_ENTRIES = 20

const OPENCODE_CONFIG_SOURCE_ORDER: readonly OpenCodeConfigSourceName[] = OPENCODE_CONFIG_FILENAMES

const OPENCODE_CONFIG_WRITABLE_PREFERENCE: readonly OpenCodeConfigSourceName[] = [...OPENCODE_CONFIG_FILENAMES].reverse()

const OPENCODE_CONFIG_DEFAULT_SOURCE: OpenCodeConfigSourceName = 'opencode.jsonc'

const OPENCODE_CONFIG_SNAPSHOT_VERSION = 1

const OPENCODE_CONFIG_SNAPSHOT_MARKER = 'opencode-config-snapshot'

const OPENCODE_CONFIG_SNAPSHOT_ARTIFACT_PREFIX = 'opencode-config-broken'

export interface UpdateOpenCodeConfigOptions {
  source?: OpenCodeConfigSourceName
  expectedRevision?: string
}

export class OpenCodeConfigConflictError extends Error {
  readonly expectedRevision: string
  readonly actualRevision: string

  constructor(expectedRevision: string, actualRevision: string) {
    super('OpenCode config was modified by another writer')
    this.name = 'OpenCodeConfigConflictError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export class OpenCodeConfigSourceInvalidError extends Error {
  readonly sources: OpenCodeConfigSourceName[]

  constructor(sources: OpenCodeConfigSourceName[]) {
    super(`OpenCode config source is invalid: ${sources.join(', ')}`)
    this.name = 'OpenCodeConfigSourceInvalidError'
    this.sources = sources
  }
}

export class OpenCodeConfigSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenCodeConfigSnapshotError'
  }
}

interface OpenCodeConfigParseResult {
  content: Record<string, unknown>
  isValid: boolean
  validationIssues?: OpenCodeConfigValidationIssue[]
}

interface OpenCodeConfigSnapshot {
  sources: OpenCodeConfigSourceFile[]
  content: Record<string, unknown>
  revision: string
  updatedAt: number
  path: string
  rawContent: string
}

interface OpenCodeConfigSourceFileState {
  name: OpenCodeConfigSourceName
  rawContent: string | null
}

interface PreparedOpenCodeConfigSourceFileState extends OpenCodeConfigSourceFileState {
  path: string
  previousMode: number | undefined
  previousRawContent: string | null
}

interface AppliedOpenCodeConfigSourceFileState {
  name: OpenCodeConfigSourceName
  previousRawContent: string | null
  previousMode: number | undefined
}

interface OpenCodeConfigPathOperation {
  path: JSONPath
  value: unknown
}

interface OpenCodeConfigSnapshotEnvelopeSource {
  name: OpenCodeConfigSourceName
  rawContent: string
}

interface OpenCodeConfigSnapshotEnvelope {
  marker: string
  version: number
  sources: OpenCodeConfigSnapshotEnvelopeSource[]
}

export function getOpenCodeConfigDirectory(): string {
  return path.dirname(getOpenCodeConfigFilePath())
}

function getOpenCodeConfigSourcePath(name: OpenCodeConfigSourceName): string {
  return path.join(getOpenCodeConfigDirectory(), name)
}

function isOpenCodeConfigSourceName(value: string): value is OpenCodeConfigSourceName {
  return (OPENCODE_CONFIG_SOURCE_ORDER as readonly string[]).includes(value)
}

function assertOpenCodeConfigSourceName(value: string): OpenCodeConfigSourceName {
  if (!isOpenCodeConfigSourceName(value)) {
    throw new Error(`Unsupported OpenCode config source: ${value}`)
  }
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function defineOwnConfigValue(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function mergeOpenCodeConfigValues(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(target)) {
    defineOwnConfigValue(output, key, target[key])
  }
  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = hasOwn(output, key) ? output[key] : undefined
    defineOwnConfigValue(
      output,
      key,
      isPlainObject(targetValue) && isPlainObject(sourceValue)
        ? mergeOpenCodeConfigValues(targetValue, sourceValue)
        : sourceValue,
    )
  }
  return output
}

export function withOpenCodeConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(getOpenCodeConfigDirectory(), fn)
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

  const content = isPlainObject(parsed) ? parsed : {}

  const validated = OpenCodeConfigSchema.safeParse(parsed)
  if (validated.success) {
    return {
      content,
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

async function readOpenCodeConfigSourceFile(name: OpenCodeConfigSourceName): Promise<OpenCodeConfigSourceFile | null> {
  const sourcePath = getOpenCodeConfigSourcePath(name)

  let updatedAt: number
  try {
    const stats = await stat(sourcePath)
    if (!stats.isFile()) return null
    updatedAt = stats.mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const rawContent = await readFile(sourcePath, 'utf8')

  return {
    name,
    path: sourcePath,
    rawContent,
    ...parseOpenCodeConfigContent(rawContent),
    updatedAt,
  }
}

function selectWritableSource(sources: OpenCodeConfigSourceFile[]): OpenCodeConfigSourceFile | null {
  for (const name of OPENCODE_CONFIG_WRITABLE_PREFERENCE) {
    const source = sources.find((candidate) => candidate.name === name)
    if (source) return source
  }
  return null
}

function computeOpenCodeConfigRevision(sources: OpenCodeConfigSourceFile[]): string {
  const hash = createHash('sha256')
  const byName = new Map(sources.map((source) => [source.name, source]))
  for (const name of OPENCODE_CONFIG_SOURCE_ORDER) {
    const source = byName.get(name)
    hash.update(name)
    hash.update('\0')
    hash.update(source ? '1' : '0')
    hash.update('\0')
    hash.update(source?.rawContent ?? '')
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function readOpenCodeConfigSnapshot(): Promise<OpenCodeConfigSnapshot> {
  const discovered = await Promise.all(OPENCODE_CONFIG_SOURCE_ORDER.map(readOpenCodeConfigSourceFile))
  const sources = discovered.filter((source): source is OpenCodeConfigSourceFile => source !== null)
  const content = sources.reduce<Record<string, unknown>>(
    (merged, source) => mergeOpenCodeConfigValues(merged, source.content),
    {},
  )
  const selected = selectWritableSource(sources)

  return {
    sources,
    content,
    revision: computeOpenCodeConfigRevision(sources),
    updatedAt: sources.reduce((latest, source) => Math.max(latest, source.updatedAt), 0),
    path: selected ? selected.path : getOpenCodeConfigSourcePath(OPENCODE_CONFIG_DEFAULT_SOURCE),
    rawContent: selected ? selected.rawContent : '',
  }
}

function toOpenCodeConfigFile(snapshot: OpenCodeConfigSnapshot): OpenCodeConfigFile {
  const validationIssues = snapshot.sources.flatMap((source) => source.validationIssues ?? [])
  return {
    path: snapshot.path,
    rawContent: snapshot.rawContent,
    content: snapshot.content,
    isValid: snapshot.sources.every((source) => source.isValid),
    validationIssues: validationIssues.length > 0 ? validationIssues : undefined,
    updatedAt: snapshot.updatedAt,
    sources: snapshot.sources,
    revision: snapshot.revision,
  }
}

export async function readOpenCodeConfigFile(): Promise<OpenCodeConfigFile | null> {
  const snapshot = await readOpenCodeConfigSnapshot()
  if (snapshot.sources.length === 0) return null
  return toOpenCodeConfigFile(snapshot)
}

export async function writeOpenCodeConfigFile(
  rawContent: string,
  source?: OpenCodeConfigSourceName,
): Promise<OpenCodeConfigFile> {
  OpenCodeConfigSchema.parse(parseJsonc(rawContent))

  const snapshot = await readOpenCodeConfigSnapshot()
  const targetName = source !== undefined
    ? assertOpenCodeConfigSourceName(source)
    : selectWritableSource(snapshot.sources)?.name ?? OPENCODE_CONFIG_DEFAULT_SOURCE
  const targetPath = getOpenCodeConfigSourcePath(targetName)

  await writeFileAtomic(targetPath, rawContent, { mode: await existingFileMode(targetPath) })

  return toOpenCodeConfigFile(await readOpenCodeConfigSnapshot())
}

function collectOpenCodeConfigPathOperations(
  requested: Record<string, unknown>,
  current: Record<string, unknown>,
  basePath: JSONPath = [],
): OpenCodeConfigPathOperation[] {
  const operations: OpenCodeConfigPathOperation[] = []

  for (const key of Object.keys(requested)) {
    const requestedValue = requested[key]
    const hasCurrent = hasOwn(current, key)
    const currentValue = hasCurrent ? current[key] : undefined
    const nextPath = [...basePath, key]
    if (isPlainObject(requestedValue) && isPlainObject(currentValue)) {
      operations.push(...collectOpenCodeConfigPathOperations(requestedValue, currentValue, nextPath))
    } else if (!hasCurrent || !isDeepStrictEqual(requestedValue, currentValue)) {
      operations.push({ path: nextPath, value: requestedValue })
    }
  }

  for (const key of Object.keys(current)) {
    if (hasOwn(requested, key)) continue
    operations.push({ path: [...basePath, key], value: undefined })
  }

  return operations
}

function applyOpenCodeConfigPathOperations(
  rawContent: string,
  operations: OpenCodeConfigPathOperation[],
): string {
  let text = rawContent
  for (const operation of operations) {
    const edits = modify(text, operation.path, operation.value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    text = applyEdits(text, edits)
  }
  return text
}

export async function updateOpenCodeConfigFile(
  content: Record<string, unknown> | string,
  options: UpdateOpenCodeConfigOptions = {},
): Promise<OpenCodeConfigFile> {
  const snapshot = await readOpenCodeConfigSnapshot()

  if (options.expectedRevision !== undefined && options.expectedRevision !== snapshot.revision) {
    throw new OpenCodeConfigConflictError(options.expectedRevision, snapshot.revision)
  }

  const targetName = options.source !== undefined
    ? assertOpenCodeConfigSourceName(options.source)
    : selectWritableSource(snapshot.sources)?.name ?? OPENCODE_CONFIG_DEFAULT_SOURCE
  const targetSource = snapshot.sources.find((source) => source.name === targetName)
  const targetPath = getOpenCodeConfigSourcePath(targetName)

  if (typeof content === 'string') {
    if (targetSource?.rawContent === content) {
      return toOpenCodeConfigFile(snapshot)
    }
    return writeOpenCodeConfigFile(content, targetName)
  }

  const invalidSources = snapshot.sources.filter((source) => !source.isValid).map((source) => source.name)
  if (invalidSources.length > 0) {
    throw new OpenCodeConfigSourceInvalidError(invalidSources)
  }

  OpenCodeConfigSchema.parse(content)

  const originalText = targetSource?.rawContent ?? '{}\n'
  const operations = collectOpenCodeConfigPathOperations(content, snapshot.content)
  const updatedText = applyOpenCodeConfigPathOperations(originalText, operations)

  if (updatedText !== originalText) {
    OpenCodeConfigSchema.parse(parseJsonc(updatedText))
    await writeFileAtomic(targetPath, updatedText, { mode: await existingFileMode(targetPath) })
  }

  return toOpenCodeConfigFile(await readOpenCodeConfigSnapshot())
}

function resolveSnapshotSources(config: OpenCodeConfigFile): OpenCodeConfigSnapshotEnvelopeSource[] {
  if (config.sources && config.sources.length > 0) {
    return config.sources.map((source) => ({ name: source.name, rawContent: source.rawContent }))
  }
  const fileName = path.basename(config.path)
  const name = isOpenCodeConfigSourceName(fileName) ? fileName : 'opencode.json'
  return [{ name, rawContent: config.rawContent }]
}

export function serializeOpenCodeConfigSnapshot(config: OpenCodeConfigFile): string {
  const envelope: OpenCodeConfigSnapshotEnvelope = {
    marker: OPENCODE_CONFIG_SNAPSHOT_MARKER,
    version: OPENCODE_CONFIG_SNAPSHOT_VERSION,
    sources: resolveSnapshotSources(config),
  }
  return JSON.stringify(envelope, null, 2)
}

function isSnapshotEnvelopeCandidate(parsed: Record<string, unknown>): boolean {
  return hasOwn(parsed, 'marker') || (hasOwn(parsed, 'sources') && hasOwn(parsed, 'version'))
}

function parseOpenCodeConfigSnapshot(snapshot: string): Map<OpenCodeConfigSourceName, string> {
  let parsed: unknown
  try {
    parsed = parseJsonc(snapshot)
  } catch {
    throw new OpenCodeConfigSnapshotError('Invalid OpenCode config snapshot content')
  }

  if (isPlainObject(parsed) && isSnapshotEnvelopeCandidate(parsed)) {
    if (hasOwn(parsed, 'marker') && parsed.marker !== OPENCODE_CONFIG_SNAPSHOT_MARKER) {
      throw new OpenCodeConfigSnapshotError('Invalid OpenCode config snapshot marker')
    }
    if (parsed.version !== OPENCODE_CONFIG_SNAPSHOT_VERSION) {
      throw new OpenCodeConfigSnapshotError(`Unsupported OpenCode config snapshot version: ${String(parsed.version)}`)
    }
    if (!Array.isArray(parsed.sources)) {
      throw new OpenCodeConfigSnapshotError('Invalid OpenCode config snapshot sources')
    }

    const sources = new Map<OpenCodeConfigSourceName, string>()
    for (const entry of parsed.sources) {
      if (!isPlainObject(entry)) {
        throw new OpenCodeConfigSnapshotError('Invalid OpenCode config snapshot source')
      }
      if (typeof entry.name !== 'string' || !isOpenCodeConfigSourceName(entry.name)) {
        throw new OpenCodeConfigSnapshotError(`Invalid OpenCode config snapshot source name: ${String(entry.name)}`)
      }
      if (typeof entry.rawContent !== 'string') {
        throw new OpenCodeConfigSnapshotError('Invalid OpenCode config snapshot source content')
      }
      if (sources.has(entry.name)) {
        throw new OpenCodeConfigSnapshotError(`Duplicate OpenCode config snapshot source: ${entry.name}`)
      }
      if (!parseOpenCodeConfigContent(entry.rawContent).isValid) {
        throw new OpenCodeConfigSnapshotError(`Invalid OpenCode config snapshot content: ${entry.name}`)
      }
      sources.set(entry.name, entry.rawContent)
    }
    return sources
  }

  if (!parseOpenCodeConfigContent(snapshot).isValid) {
    throw new OpenCodeConfigSnapshotError('Invalid OpenCode config snapshot content')
  }

  return new Map([['opencode.json', snapshot]])
}

async function readRawContentOrNull(sourcePath: string): Promise<string | null> {
  try {
    return await readFile(sourcePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function rollbackOpenCodeConfigSourceFileStates(
  applied: AppliedOpenCodeConfigSourceFileState[],
): Promise<Error[]> {
  const failures: Error[] = []
  for (const entry of [...applied].reverse()) {
    const sourcePath = getOpenCodeConfigSourcePath(entry.name)
    try {
      if (entry.previousRawContent === null) {
        await rm(sourcePath, { force: true })
      } else {
        await writeFileAtomic(sourcePath, entry.previousRawContent, { mode: entry.previousMode })
      }
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return failures
}

async function applyOpenCodeConfigSourceFileStates(
  states: OpenCodeConfigSourceFileState[],
): Promise<void> {
  const prepared: PreparedOpenCodeConfigSourceFileState[] = []
  for (const state of states) {
    const sourcePath = getOpenCodeConfigSourcePath(state.name)
    const previousMode = await existingFileMode(sourcePath)
    const previousRawContent = await readRawContentOrNull(sourcePath)
    prepared.push({ ...state, path: sourcePath, previousMode, previousRawContent })
  }

  const applied: AppliedOpenCodeConfigSourceFileState[] = []
  try {
    for (const state of prepared) {
      if (state.rawContent === null) {
        await rm(state.path, { force: true })
      } else {
        await writeFileAtomic(state.path, state.rawContent, { mode: state.previousMode })
      }
      applied.push({
        name: state.name,
        previousRawContent: state.previousRawContent,
        previousMode: state.previousMode,
      })
    }
  } catch (error) {
    const rollbackFailures = await rollbackOpenCodeConfigSourceFileStates(applied)
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        'Failed to apply OpenCode config source states and roll back',
      )
    }
    throw error
  }
}

export async function restoreOpenCodeConfigSnapshot(snapshot: string): Promise<OpenCodeConfigFile | null> {
  const desired = parseOpenCodeConfigSnapshot(snapshot)
  const current = await readOpenCodeConfigSnapshot()
  const currentNames = new Set(current.sources.map((source) => source.name))

  const states: OpenCodeConfigSourceFileState[] = []
  for (const name of OPENCODE_CONFIG_SOURCE_ORDER) {
    if (desired.has(name)) {
      states.push({ name, rawContent: desired.get(name) ?? '' })
    } else if (currentNames.has(name)) {
      states.push({ name, rawContent: null })
    }
  }

  await applyOpenCodeConfigSourceFileStates(states)
  return readOpenCodeConfigFile()
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
  await writeFileAtomic(artifactPath, buildContent(timestamp), { mode: 0o600 })
  await pruneHealthWatchDirectory(getOpenCodeHealthWatchPath())
  return artifactPath
}

export async function archiveBrokenOpenCodeConfigFile(): Promise<string | null> {
  const snapshot = await readOpenCodeConfigSnapshot()
  if (snapshot.sources.length === 0) {
    return null
  }

  const payload = serializeOpenCodeConfigSnapshot(toOpenCodeConfigFile(snapshot))
  const archivePath = await writeHealthWatchArtifact(OPENCODE_CONFIG_SNAPSHOT_ARTIFACT_PREFIX, () => payload)
  logger.warn(`Archived broken OpenCode config to ${archivePath}`)
  return archivePath
}

export async function deleteOpenCodeConfigFile(): Promise<boolean> {
  return withOpenCodeConfigLock(async () => {
    const snapshot = await readOpenCodeConfigSnapshot()
    if (snapshot.sources.length === 0) return false
    await applyOpenCodeConfigSourceFileStates(
      snapshot.sources.map((source) => ({ name: source.name, rawContent: null })),
    )
    logger.info('Deleted filesystem config to allow server startup:', snapshot.sources.map((source) => source.path).join(', '))
    return true
  })
}
