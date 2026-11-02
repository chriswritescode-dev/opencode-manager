import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { readFile, readdir, rename, rm, stat } from 'fs/promises'
import path from 'path'
import { isDeepStrictEqual } from 'node:util'
import { applyEdits, findNodeAtLocation, modify, parseTree, type Edit, type JSONPath } from 'jsonc-parser'
import { getConfigPath, getOpenCodeConfigHome, getOpenCodeHealthWatchPath } from '@opencode-manager/shared/config/env'
import {
  DEFAULT_OPENCODE_CONFIG_SOURCE_NAME,
  LEGACY_OPENCODE_CONFIG_SOURCE_NAME,
  OPENCODE_CONFIG_SOURCE_NAMES,
  isOpenCodeConfigSourceName,
  selectPreferredOpenCodeConfigSourceName,
} from '@opencode-manager/shared'
import { validateOpenCodeConfig } from '@opencode-manager/shared/opencode/config-validation'
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
import { restoreEnforcementSections, type EnforcementRemovedSections } from './opencode/enforcement-config'
import { ensureDirectoryExists } from './file-operations'

export const OPENCODE_CONFIG_SEED = JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)

export const HEALTH_WATCH_MAX_ENTRIES = 20

const OPENCODE_CONFIG_ARCHIVE_DIR_NAME = 'opencode-configs-archive'

export type OpenCodeConfigRestorableSourceName = OpenCodeConfigSourceName | typeof LEGACY_OPENCODE_CONFIG_SOURCE_NAME

const OPENCODE_CONFIG_SOURCE_ORDER: readonly OpenCodeConfigSourceName[] = OPENCODE_CONFIG_SOURCE_NAMES

const OPENCODE_CONFIG_SNAPSHOT_VERSION = 1

const OPENCODE_CONFIG_SNAPSHOT_MARKER = 'opencode-config-snapshot'

const OPENCODE_CONFIG_SNAPSHOT_ARTIFACT_PREFIX = 'opencode-config-broken'

const OPENCODE_CONFIG_LEGACY_BACKUP_SUFFIX = '.ocm-sandbox-backup'

export type OpenCodeConfigUpdateMode = 'replace' | 'merge'

export interface UpdateOpenCodeConfigOptions {
  source?: OpenCodeConfigSourceName
  expectedRevision?: string
  snapshot?: OpenCodeConfigSnapshot
  mode?: OpenCodeConfigUpdateMode
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

export class OpenCodeConfigShadowedRemovalError extends Error {
  readonly paths: string[]
  readonly sources: OpenCodeConfigSourceName[]

  constructor(paths: string[], sources: OpenCodeConfigSourceName[], targetName: OpenCodeConfigSourceName) {
    super(`Cannot remove ${paths.join(', ')}: defined in ${sources.join(', ')}, not in ${targetName}`)
    this.name = 'OpenCodeConfigShadowedRemovalError'
    this.paths = paths
    this.sources = sources
  }
}

export const OPENCODE_CONFIG_REDACTED_VALUE = '<redacted>'

export class OpenCodeConfigRedactedValueError extends Error {
  readonly paths: string[]

  constructor(paths: string[]) {
    super('Configuration contains redacted placeholder values')
    this.name = 'OpenCodeConfigRedactedValueError'
    this.paths = paths
  }
}

export class OpenCodeConfigValidationError extends Error {
  readonly issues: OpenCodeConfigValidationIssue[]

  constructor(issues: OpenCodeConfigValidationIssue[]) {
    super('OpenCode config is invalid')
    this.name = 'OpenCodeConfigValidationError'
    this.issues = issues
  }
}

interface OpenCodeConfigParseResult {
  content: Record<string, unknown>
  isValid: boolean
  validationIssues?: OpenCodeConfigValidationIssue[]
}

export interface OpenCodeConfigSnapshot {
  sources: OpenCodeConfigSourceFile[]
  content: Record<string, unknown>
  revision: string
  updatedAt: number
  path: string
  rawContent: string
}

interface OpenCodeConfigSourceFileState {
  name: OpenCodeConfigRestorableSourceName
  rawContent: string | null
}

interface PreparedOpenCodeConfigSourceFileState extends OpenCodeConfigSourceFileState {
  path: string
  previousMode: number | undefined
  previousRawContent: string | null
}

interface AppliedOpenCodeConfigSourceFileState {
  name: OpenCodeConfigRestorableSourceName
  previousRawContent: string | null
  previousMode: number | undefined
}

export interface OpenCodeConfigPathOperation {
  path: JSONPath
  value: unknown
}

interface OpenCodeConfigV1EntityPath {
  v2Path: string[]
  v1Path: string[]
  named: boolean
  reservedNames?: readonly string[]
}

interface OpenCodeConfigV1EntityRemoval {
  path: JSONPath
  container?: JSONPath
}

const V1_ENTITY_PATHS: readonly OpenCodeConfigV1EntityPath[] = [
  { v2Path: ['agents'], v1Path: ['agent'], named: true },
  { v2Path: ['commands'], v1Path: ['command'], named: true },
  { v2Path: ['providers'], v1Path: ['provider'], named: true },
  { v2Path: ['mcp', 'servers'], v1Path: ['mcp'], named: true, reservedNames: ['servers', 'timeout'] },
  { v2Path: ['permissions'], v1Path: ['permission'], named: false },
]

interface OpenCodeConfigSnapshotEnvelopeSource {
  name: OpenCodeConfigRestorableSourceName
  rawContent: string
}

interface OpenCodeConfigSnapshotEnvelope {
  marker: string
  version: number
  sources: OpenCodeConfigSnapshotEnvelopeSource[]
}

function getOpenCodeConfigDirectory(): string {
  return getConfigPath()
}

function getOpenCodeConfigSourcePath(name: OpenCodeConfigRestorableSourceName): string {
  return path.join(getOpenCodeConfigDirectory(), name)
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

interface ReadOpenCodeConfigPathOptions {
  nullAncestorCountsAsFound?: boolean
}

function readOpenCodeConfigPath(
  content: Record<string, unknown>,
  jsonPath: JSONPath,
  options: ReadOpenCodeConfigPathOptions = {},
): { found: boolean; value: unknown } {
  let current: unknown = content
  for (const segment of jsonPath) {
    if (options.nullAncestorCountsAsFound && current === null) return { found: true, value: null }
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return { found: false, value: undefined }
      }
      current = current[segment]
      continue
    }
    if (!isPlainObject(current) || !hasOwn(current, segment)) return { found: false, value: undefined }
    current = current[segment]
  }
  return { found: true, value: current }
}

function hasOpenCodeConfigPath(content: Record<string, unknown>, jsonPath: JSONPath): boolean {
  return readOpenCodeConfigPath(content, jsonPath).found
}

function defineOwnConfigValue(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function stripNullOpenCodeConfigValues(value: unknown): unknown {
  if (!isPlainObject(value)) return value
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const entry = value[key]
    if (entry === null) continue
    defineOwnConfigValue(output, key, stripNullOpenCodeConfigValues(entry))
  }
  return output
}

function collectOpenCodeConfigRedactedPaths(value: unknown, basePath: string[] = []): string[] {
  const paths: string[] = []
  if (typeof value === 'string') {
    if (value === OPENCODE_CONFIG_REDACTED_VALUE) paths.push(basePath.join('.'))
    return paths
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      paths.push(...collectOpenCodeConfigRedactedPaths(entry, [...basePath, String(index)]))
    })
    return paths
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      paths.push(...collectOpenCodeConfigRedactedPaths(value[key], [...basePath, key]))
    }
  }
  return paths
}

function assertNoOpenCodeConfigRedactedValues(value: unknown): void {
  const paths = collectOpenCodeConfigRedactedPaths(value)
  if (paths.length > 0) {
    throw new OpenCodeConfigRedactedValueError(paths)
  }
}

interface MergeOpenCodeConfigValuesOptions {
  deleteNullValues?: boolean
}

export function mergeOpenCodeConfigValues(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  options: MergeOpenCodeConfigValuesOptions = {},
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(target)) {
    defineOwnConfigValue(output, key, target[key])
  }
  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    if (options.deleteNullValues && sourceValue === null) {
      delete output[key]
      continue
    }
    const targetValue = hasOwn(output, key) ? output[key] : undefined
    let nextValue: unknown
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      nextValue = mergeOpenCodeConfigValues(targetValue, sourceValue, options)
    } else if (options.deleteNullValues) {
      nextValue = stripNullOpenCodeConfigValues(sourceValue)
    } else {
      nextValue = sourceValue
    }
    defineOwnConfigValue(output, key, nextValue)
  }
  return output
}

export function withOpenCodeConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(getOpenCodeConfigDirectory(), fn)
}

function assertValidOpenCodeConfig(value: unknown): void {
  const result = validateOpenCodeConfig(value)
  if (!result.success) throw new OpenCodeConfigValidationError(result.issues)
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

  const validated = validateOpenCodeConfig(parsed)
  if (validated.success) {
    return {
      content,
      isValid: true,
    }
  }

  const validationIssues = validated.issues
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
  const name = selectPreferredOpenCodeConfigSourceName(sources.map((source) => source.name))
  return name ? sources.find((source) => source.name === name) ?? null : null
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

export async function readOpenCodeConfigSnapshot(): Promise<OpenCodeConfigSnapshot> {
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
    path: selected ? selected.path : getOpenCodeConfigSourcePath(DEFAULT_OPENCODE_CONFIG_SOURCE_NAME),
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

export async function readOpenCodeConfigFile(
  snapshot?: OpenCodeConfigSnapshot,
): Promise<OpenCodeConfigFile | null> {
  const resolved = snapshot ?? await readOpenCodeConfigSnapshot()
  if (resolved.sources.length === 0) return null
  return toOpenCodeConfigFile(resolved)
}

export async function writeOpenCodeConfigFile(
  rawContent: string,
  source?: OpenCodeConfigSourceName,
  snapshot?: OpenCodeConfigSnapshot,
): Promise<OpenCodeConfigFile> {
  assertValidOpenCodeConfig(parseJsonc(rawContent))

  const resolved = snapshot ?? await readOpenCodeConfigSnapshot()
  const targetName = source !== undefined
    ? assertOpenCodeConfigSourceName(source)
    : selectWritableSource(resolved.sources)?.name ?? DEFAULT_OPENCODE_CONFIG_SOURCE_NAME
  const targetPath = getOpenCodeConfigSourcePath(targetName)

  await writeFileAtomic(targetPath, rawContent, { mode: await existingFileMode(targetPath) })

  return toOpenCodeConfigFile(await readOpenCodeConfigSnapshot())
}

function collectOpenCodeConfigPathOperations(
  next: Record<string, unknown>,
  current: Record<string, unknown>,
  mode: OpenCodeConfigUpdateMode,
  basePath: JSONPath = [],
): OpenCodeConfigPathOperation[] {
  const operations: OpenCodeConfigPathOperation[] = []

  for (const key of Object.keys(next)) {
    const nextValue = next[key]
    const hasCurrent = hasOwn(current, key)
    const currentValue = hasCurrent ? current[key] : undefined
    const nextPath = [...basePath, key]
    if (mode === 'merge' && nextValue === null) {
      if (hasCurrent) operations.push({ path: nextPath, value: undefined })
      continue
    }
    if (isPlainObject(nextValue) && isPlainObject(currentValue)) {
      operations.push(...collectOpenCodeConfigPathOperations(nextValue, currentValue, mode, nextPath))
      continue
    }
    const appliedValue = mode === 'merge' ? stripNullOpenCodeConfigValues(nextValue) : nextValue
    if (!hasCurrent || !isDeepStrictEqual(appliedValue, currentValue)) {
      operations.push({ path: nextPath, value: appliedValue })
    }
  }

  if (mode === 'replace') {
    for (const key of Object.keys(current)) {
      if (hasOwn(next, key)) continue
      operations.push({ path: [...basePath, key], value: undefined })
    }
  }

  return operations
}

function collectOpenCodeConfigV1EntityRemovals(
  patch: Record<string, unknown>,
): OpenCodeConfigV1EntityRemoval[] {
  const removals: OpenCodeConfigV1EntityRemoval[] = []
  for (const mapping of V1_ENTITY_PATHS) {
    const patched = readOpenCodeConfigPath(patch, mapping.v2Path, { nullAncestorCountsAsFound: true })
    if (!patched.found) continue
    if (!mapping.named || patched.value === null) {
      if (!mapping.reservedNames) removals.push({ path: mapping.v1Path })
      continue
    }
    if (!isPlainObject(patched.value)) continue
    for (const name of Object.keys(patched.value)) {
      if (mapping.reservedNames?.includes(name)) continue
      removals.push({ path: [...mapping.v1Path, name], container: mapping.v1Path })
    }
  }
  return removals
}

function findOpenCodeConfigSeparatorComma(rawContent: string, start: number, end: number): number {
  let index = start
  while (index < end) {
    if (rawContent.startsWith('//', index)) {
      const newline = rawContent.indexOf('\n', index)
      if (newline < 0 || newline >= end) return -1
      index = newline + 1
      continue
    }
    if (rawContent.startsWith('/*', index)) {
      const close = rawContent.indexOf('*/', index + 2)
      if (close < 0 || close >= end) return -1
      index = close + 2
      continue
    }
    if (rawContent[index] === ',') return index
    index += 1
  }
  return -1
}

function findOpenCodeConfigLineEnd(rawContent: string, offset: number): number | null {
  let index = offset
  while (index < rawContent.length && (rawContent[index] === ' ' || rawContent[index] === '\t')) {
    index += 1
  }
  if (rawContent.startsWith('\r\n', index)) return index + 2
  if (rawContent[index] === '\n') return index + 1
  return null
}

function buildOpenCodeConfigCommentPreservingRemovalEdits(
  rawContent: string,
  jsonPath: JSONPath,
): Edit[] | null {
  const root = parseTree(rawContent)
  const node = root ? findNodeAtLocation(root, jsonPath) : undefined
  const property = node?.parent
  const container = property?.parent
  if (!property || !container?.children) return null

  const index = container.children.indexOf(property)
  const previous = index > 0 ? container.children[index - 1] : undefined
  const next = container.children[index + 1]
  const propertyEnd = property.offset + property.length
  const lineStart = rawContent.lastIndexOf('\n', property.offset - 1) + 1
  const aloneOnLine = rawContent.slice(lineStart, property.offset).trim() === ''
  const removeStart = aloneOnLine ? lineStart : property.offset

  if (next) {
    const separatorOffset = findOpenCodeConfigSeparatorComma(rawContent, propertyEnd, next.offset)
    if (separatorOffset < 0) return null
    if (rawContent.slice(propertyEnd, separatorOffset).includes('/')) {
      return [
        { offset: removeStart, length: propertyEnd - removeStart, content: '' },
        { offset: separatorOffset, length: 1, content: '' },
      ]
    }
    const lineEnd = aloneOnLine ? findOpenCodeConfigLineEnd(rawContent, separatorOffset + 1) : null
    const removeEnd = lineEnd ?? separatorOffset + 1
    return [{ offset: removeStart, length: removeEnd - removeStart, content: '' }]
  }

  const edits: Edit[] = []
  if (previous) {
    const separatorOffset = findOpenCodeConfigSeparatorComma(
      rawContent,
      previous.offset + previous.length,
      property.offset,
    )
    if (separatorOffset < 0) return null
    edits.push({ offset: separatorOffset, length: 1, content: '' })
  }
  const lineEnd = aloneOnLine ? findOpenCodeConfigLineEnd(rawContent, propertyEnd) : null
  const removeEnd = lineEnd ?? propertyEnd
  edits.push({ offset: removeStart, length: removeEnd - removeStart, content: '' })
  return edits
}

/**
 * Removes one property from raw JSONC config text while keeping neighbouring comments and formatting.
 */
export function removeOpenCodeConfigProperty(rawContent: string, jsonPath: JSONPath): string {
  const edits = buildOpenCodeConfigCommentPreservingRemovalEdits(rawContent, jsonPath)
  if (!edits) return rawContent
  return applyEdits(rawContent, edits)
}

function collectEmptyOpenCodeConfigContainers(
  rawContent: string,
  removals: OpenCodeConfigV1EntityRemoval[],
): JSONPath[] {
  const parsed = parseJsonc(rawContent)
  if (!isPlainObject(parsed)) return []

  const containers: JSONPath[] = []
  const visited = new Set<string>()
  for (const removal of removals) {
    if (!removal.container) continue
    const key = removal.container.join('\0')
    if (visited.has(key)) continue
    visited.add(key)
    const container = readOpenCodeConfigPath(parsed, removal.container)
    if (isPlainObject(container.value) && Object.keys(container.value).length === 0) {
      containers.push(removal.container)
    }
  }
  return containers
}

/**
 * Applies path edits to raw JSONC config text, preserving comments and formatting.
 */
export function applyOpenCodeConfigEdits(
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

function assertNoShadowedOpenCodeConfigRemovals(
  operations: OpenCodeConfigPathOperation[],
  targetSource: OpenCodeConfigSourceFile | undefined,
  sources: OpenCodeConfigSourceFile[],
  targetName: OpenCodeConfigSourceName,
): void {
  const targetContent = targetSource?.content ?? {}
  const shadowedPaths: string[] = []
  const shadowedSources = new Set<OpenCodeConfigSourceName>()

  for (const operation of operations) {
    if (operation.value !== undefined) continue
    if (hasOpenCodeConfigPath(targetContent, operation.path)) continue
    const definingSources = sources.filter(
      (source) => source.name !== targetName && hasOpenCodeConfigPath(source.content, operation.path),
    )
    if (definingSources.length === 0) continue
    shadowedPaths.push(operation.path.join('.'))
    for (const source of definingSources) shadowedSources.add(source.name)
  }

  if (shadowedPaths.length > 0) {
    throw new OpenCodeConfigShadowedRemovalError(shadowedPaths, [...shadowedSources], targetName)
  }
}

export async function updateOpenCodeConfigFile(
  content: Record<string, unknown> | string,
  options: UpdateOpenCodeConfigOptions = {},
): Promise<OpenCodeConfigFile> {
  const snapshot = options.snapshot ?? await readOpenCodeConfigSnapshot()

  if (options.expectedRevision !== undefined && options.expectedRevision !== snapshot.revision) {
    throw new OpenCodeConfigConflictError(options.expectedRevision, snapshot.revision)
  }

  const targetName = options.source !== undefined
    ? assertOpenCodeConfigSourceName(options.source)
    : selectWritableSource(snapshot.sources)?.name ?? DEFAULT_OPENCODE_CONFIG_SOURCE_NAME
  const targetSource = snapshot.sources.find((source) => source.name === targetName)
  const targetPath = getOpenCodeConfigSourcePath(targetName)

  if (typeof content === 'string') {
    if (targetSource?.rawContent === content) {
      return toOpenCodeConfigFile(snapshot)
    }
    assertNoOpenCodeConfigRedactedValues(parseJsonc(content))
    return writeOpenCodeConfigFile(content, targetName, snapshot)
  }

  assertNoOpenCodeConfigRedactedValues(content)

  const invalidSources = snapshot.sources.filter((source) => !source.isValid).map((source) => source.name)
  if (invalidSources.length > 0) {
    throw new OpenCodeConfigSourceInvalidError(invalidSources)
  }

  const mode = options.mode ?? 'replace'
  const operations = collectOpenCodeConfigPathOperations(content, snapshot.content, mode)
  const v1EntityRemovals = mode === 'merge' ? collectOpenCodeConfigV1EntityRemovals(content) : []

  assertValidOpenCodeConfig(
    mode === 'merge' ? mergeOpenCodeConfigValues(snapshot.content, content, { deleteNullValues: true }) : content,
  )

  const originalText = targetSource?.rawContent ?? '{}\n'
  assertNoShadowedOpenCodeConfigRemovals(
    [...operations, ...v1EntityRemovals.map((removal) => ({ path: removal.path, value: undefined }))],
    targetSource,
    snapshot.sources,
    targetName,
  )

  let updatedText = applyOpenCodeConfigEdits(originalText, operations)
  for (const removal of v1EntityRemovals) {
    updatedText = removeOpenCodeConfigProperty(updatedText, removal.path)
  }
  for (const container of collectEmptyOpenCodeConfigContainers(updatedText, v1EntityRemovals)) {
    updatedText = removeOpenCodeConfigProperty(updatedText, container)
  }

  if (updatedText !== originalText) {
    assertValidOpenCodeConfig(parseJsonc(updatedText))
    await writeFileAtomic(targetPath, updatedText, { mode: await existingFileMode(targetPath) })
  }

  return toOpenCodeConfigFile(await readOpenCodeConfigSnapshot())
}

export function serializeOpenCodeConfigSourceSnapshot(
  entries: ReadonlyArray<{ name: OpenCodeConfigRestorableSourceName; rawContent: string }>,
): string {
  const envelope: OpenCodeConfigSnapshotEnvelope = {
    marker: OPENCODE_CONFIG_SNAPSHOT_MARKER,
    version: OPENCODE_CONFIG_SNAPSHOT_VERSION,
    sources: entries.map((entry) => ({ name: entry.name, rawContent: entry.rawContent })),
  }
  return JSON.stringify(envelope, null, 2)
}

export function serializeOpenCodeConfigSnapshot(
  config: Pick<OpenCodeConfigFile, 'sources'>,
): string {
  return serializeOpenCodeConfigSourceSnapshot(config.sources)
}

export function buildOpenCodeConfigSeedSnapshot(): string {
  return serializeOpenCodeConfigSourceSnapshot([
    { name: DEFAULT_OPENCODE_CONFIG_SOURCE_NAME, rawContent: OPENCODE_CONFIG_SEED },
  ])
}

function isSnapshotEnvelopeCandidate(parsed: Record<string, unknown>): boolean {
  return hasOwn(parsed, 'marker') || (hasOwn(parsed, 'sources') && hasOwn(parsed, 'version'))
}

function isRestorableOpenCodeConfigSourceName(value: string): value is OpenCodeConfigRestorableSourceName {
  return isOpenCodeConfigSourceName(value) || value === LEGACY_OPENCODE_CONFIG_SOURCE_NAME
}

export function toOpenCodeConfigRestorableSourceName(value: string): OpenCodeConfigRestorableSourceName | null {
  return isRestorableOpenCodeConfigSourceName(value) ? value : null
}

function parseOpenCodeConfigSnapshot(snapshot: string): Map<OpenCodeConfigRestorableSourceName, string> {
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

    const sources = new Map<OpenCodeConfigRestorableSourceName, string>()
    for (const entry of parsed.sources) {
      if (!isPlainObject(entry)) {
        throw new OpenCodeConfigSnapshotError('Invalid OpenCode config snapshot source')
      }
      if (typeof entry.name !== 'string' || !isRestorableOpenCodeConfigSourceName(entry.name)) {
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
  current: OpenCodeConfigSnapshot,
): Promise<void> {
  const previousByName = new Map<string, string | null>(
    current.sources.map((source) => [source.name, source.rawContent]),
  )
  const prepared: PreparedOpenCodeConfigSourceFileState[] = []
  for (const state of states) {
    const sourcePath = getOpenCodeConfigSourcePath(state.name)
    const previousMode = await existingFileMode(sourcePath)
    const previousRawContent = previousByName.get(state.name) ?? null
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
  const currentNames = new Set<string>(current.sources.map((source) => source.name))

  const restorableOrder: readonly OpenCodeConfigRestorableSourceName[] = [
    ...OPENCODE_CONFIG_SOURCE_ORDER,
    LEGACY_OPENCODE_CONFIG_SOURCE_NAME,
  ]
  const states: OpenCodeConfigSourceFileState[] = []
  for (const name of restorableOrder) {
    if (desired.has(name)) {
      states.push({ name, rawContent: desired.get(name) ?? '' })
    } else if (currentNames.has(name)) {
      states.push({ name, rawContent: null })
    }
  }

  await applyOpenCodeConfigSourceFileStates(states, current)
  await foldLegacyConfigJsonSource()
  return readOpenCodeConfigFile()
}

async function archiveLegacyConfigJsonSource(rawContent: string): Promise<string> {
  const archiveDirectory = path.join(getOpenCodeConfigHome(), OPENCODE_CONFIG_ARCHIVE_DIR_NAME)
  await ensureDirectoryExists(archiveDirectory)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archivePath = path.join(archiveDirectory, `${LEGACY_OPENCODE_CONFIG_SOURCE_NAME}.${timestamp}`)
  await writeFileAtomic(archivePath, rawContent, { mode: 0o600 })
  return archivePath
}

export async function foldLegacyConfigJsonSource(): Promise<boolean> {
  const legacyPath = getOpenCodeConfigSourcePath(LEGACY_OPENCODE_CONFIG_SOURCE_NAME)

  let rawContent: string
  try {
    rawContent = await readFile(legacyPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`Failed to read legacy OpenCode config ${legacyPath}:`, error)
    }
    return false
  }

  try {
    const legacyContent = parseJsonc(rawContent)
    if (!isPlainObject(legacyContent)) {
      logger.warn(`Leaving legacy OpenCode config ${legacyPath} in place: its root is not an object`)
      return false
    }

    const [lowestPrecedenceSource] = (await readOpenCodeConfigSnapshot()).sources
    if (lowestPrecedenceSource && !lowestPrecedenceSource.isValid) {
      logger.warn(`Leaving legacy OpenCode config ${legacyPath} in place: ${lowestPrecedenceSource.path} is invalid`)
      return false
    }

    const archivePath = await archiveLegacyConfigJsonSource(rawContent)
    if (!lowestPrecedenceSource) {
      const promotedPath = getOpenCodeConfigSourcePath('opencode.json')
      await rename(legacyPath, promotedPath)
      logger.info(`Folded legacy OpenCode config ${legacyPath} into ${promotedPath} and archived it to ${archivePath}`)
      return true
    }

    const operations = collectOpenCodeConfigPathOperations(legacyContent, lowestPrecedenceSource.content, 'replace')
      .filter((operation) => operation.value !== undefined && !hasOpenCodeConfigPath(lowestPrecedenceSource.content, operation.path))
    if (operations.length > 0) {
      const updatedText = applyOpenCodeConfigEdits(lowestPrecedenceSource.rawContent, operations)
      assertValidOpenCodeConfig(parseJsonc(updatedText))
      await writeFileAtomic(lowestPrecedenceSource.path, updatedText, { mode: await existingFileMode(lowestPrecedenceSource.path) })
    }
    await rm(legacyPath, { force: true })
    logger.info(`Folded legacy OpenCode config ${legacyPath} into ${lowestPrecedenceSource.path} and archived it to ${archivePath}`)
    return true
  } catch (error) {
    logger.warn(`Failed to fold legacy OpenCode config ${legacyPath}:`, error)
    return false
  }
}

export async function restoreLegacyOpenCodeConfigBackup(configPath: string): Promise<void> {
  const backupPath = `${configPath}${OPENCODE_CONFIG_LEGACY_BACKUP_SUFFIX}`
  await withFileLock(path.dirname(configPath), async () => {
    let backupContent: string
    try {
      backupContent = await fs.readFile(backupPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error(`cannot read legacy backup ${backupPath}: ${error instanceof Error ? error.message : String(error)}`)
    }

    let currentContent: string
    try {
      currentContent = await fs.readFile(configPath, 'utf8')
    } catch (error) {
      throw new Error(`cannot read config ${configPath} while restoring legacy backup: ${error instanceof Error ? error.message : String(error)}`)
    }

    let backupRecord: unknown
    try {
      backupRecord = parseJsonc(backupContent)
    } catch (error) {
      throw new Error(`cannot parse legacy backup ${backupPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!isPlainObject(backupRecord)) {
      throw new Error(`legacy backup ${backupPath} is malformed`)
    }

    const removed: EnforcementRemovedSections = isPlainObject(backupRecord.removedSections)
      ? backupRecord.removedSections
      : {
        plugin: Array.isArray(backupRecord.originalPlugins)
          ? backupRecord.originalPlugins
          : Array.isArray(backupRecord.plugin) ? backupRecord.plugin : [],
      }

    let currentConfig: unknown
    try {
      currentConfig = parseJsonc(currentContent)
    } catch (error) {
      throw new Error(`cannot parse config ${configPath} while restoring legacy backup: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!isPlainObject(currentConfig)) {
      throw new Error(`config ${configPath} is not an object while restoring legacy backup`)
    }

    const restored = restoreEnforcementSections(currentConfig, removed)
    const restoredContent = JSON.stringify(restored, null, 2)
    if (restoredContent !== currentContent) {
      const mode = await existingFileMode(configPath)
      await writeFileAtomic(configPath, restoredContent, { mode })
    }
    await fs.rm(backupPath, { force: true })
  })
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
  try {
    const snapshot = await readOpenCodeConfigSnapshot()
    if (snapshot.sources.length === 0) {
      return null
    }

    const payload = serializeOpenCodeConfigSnapshot(toOpenCodeConfigFile(snapshot))
    const archivePath = await writeHealthWatchArtifact(OPENCODE_CONFIG_SNAPSHOT_ARTIFACT_PREFIX, () => payload)
    logger.warn(`Archived broken OpenCode config to ${archivePath}`)
    return archivePath
  } catch (error) {
    logger.warn('Failed to archive broken OpenCode config:', error)
    return null
  }
}

export async function deleteOpenCodeConfigFile(): Promise<boolean> {
  return withOpenCodeConfigLock(async () => {
    const snapshot = await readOpenCodeConfigSnapshot()
    if (snapshot.sources.length === 0) return false
    await applyOpenCodeConfigSourceFileStates(
      snapshot.sources.map((source) => ({ name: source.name, rawContent: null })),
      snapshot,
    )
    logger.info('Deleted filesystem config to allow server startup:', snapshot.sources.map((source) => source.path).join(', '))
    return true
  })
}
