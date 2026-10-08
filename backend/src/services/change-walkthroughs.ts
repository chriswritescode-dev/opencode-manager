import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  formatOpenCodeModelRef,
  isSessionNotFoundError,
  parseOpenCodeModelRef,
  type FileDiffInfo,
  type ModelRef,
  type SessionInfo,
} from '@opencode-manager/shared/opencode'
import {
  DEFAULT_WALKTHROUGH_SOURCE,
  WALKTHROUGH_DIFF_MAX_CHARS,
  WALKTHROUGH_HUNK_MAX_CHARS,
  WALKTHROUGH_MAX_STOPS,
  WALKTHROUGH_OUTLINE_LINE_MAX_CHARS,
  WALKTHROUGH_OUTLINE_PREVIEW_LINES,
  WALKTHROUGH_TEXT_MAX_CHARS,
  describeWalkthroughSource,
  walkthroughSourceKey,
  type ChangeWalkthrough,
  type ChangeWalkthroughState,
  type GenerateChangeWalkthroughRequest,
  type WalkthroughGenerationError,
  type WalkthroughHunk,
  type WalkthroughOmittedFile,
  type WalkthroughSource,
  type WalkthroughStop,
} from '@opencode-manager/shared/schemas'
import { splitDiffHunks, type DiffHunk } from '@opencode-manager/shared/utils'
import { deleteChangeWalkthroughs, getChangeWalkthrough, saveChangeWalkthrough } from '../db/change-walkthroughs'
import { getErrorMessage } from '../utils/error-utils'
import { ServiceError } from '../utils/service-error'
import { truncateText } from '../utils/text-truncate'
import { extractFirstJsonObject } from '../utils/json-extract'
import { mapWithConcurrency } from '../utils/concurrency'
import { logger } from '../utils/logger'
import { GenerateTextTimeoutError, generateTextWithTimeout } from './opencode/generate-text'
import type { OpenCodeClient } from './opencode/client'
import { ChangeWalkthroughError } from './change-walkthrough-error'
import { readWalkthroughChanges } from './walkthrough-sources'
import type { GitAuthService } from './git-auth'
import type { SettingsService } from './settings'
import type { SSEEvent } from './sse-aggregator'

const DEFAULT_TIMEOUT_MS = 120_000
const WALKTHROUGH_CALL_ATTEMPTS = 2
const WALKTHROUGH_EXPLAIN_CONCURRENCY = 4
const WALKTHROUGH_PROMPT_VERSION = '2'
const HUNK_TRUNCATION_MARKER = '\n[hunk truncated]'
const TEXT_TRUNCATION_MARKER = ''
const REMAINING_STOP_TITLE = 'Remaining changes'
const REMAINING_STOP_EXPLANATION = 'These changes were not covered by the generated walkthrough.'
const MECHANICAL_STOP_TITLE = 'Mechanical changes'
const MECHANICAL_STOP_EXPLANATION =
  'Lock files, snapshots and generated files. Their contents were not sent to the model.'
const MECHANICAL_ONLY_SUMMARY = 'Only lock files, snapshots or generated files changed.'

const MECHANICAL_LOCKFILE_NAMES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'go.sum',
  'flake.lock',
])

const MECHANICAL_SUFFIXES = ['.snap', '.min.js', '.min.css', '.map']

export function isMechanicalChangePath(file: string): boolean {
  const segments = file.split('/')
  const basename = segments.at(-1) ?? file
  if (MECHANICAL_LOCKFILE_NAMES.has(basename)) {
    return true
  }
  if (MECHANICAL_SUFFIXES.some((suffix) => file.endsWith(suffix))) {
    return true
  }
  return segments.includes('__snapshots__')
}

const modelStopSchema = z.object({
  title: z.string().catch(''),
  explanation: z.string().catch(''),
  hunkIds: z.array(z.string()).catch([]),
})

const modelResponseSchema = z.object({
  summary: z.string().catch(''),
  stops: z.array(modelStopSchema),
})

export interface WalkthroughInput {
  hunks: WalkthroughHunk[]
  mechanicalHunks: WalkthroughHunk[]
  omittedFiles: WalkthroughOmittedFile[]
}

export interface ParsedWalkthrough {
  summary: string
  stops: WalkthroughStop[]
}

export interface ChangeWalkthroughServiceOptions {
  timeoutMs?: number
}

export { ChangeWalkthroughError } from './change-walkthrough-error'

export function computeChangesHash(changes: FileDiffInfo[]): string {
  const hash = createHash('sha256')
  for (const change of changes) {
    hash.update(`${change.file}\0${change.status}\0${change.patch}\n`)
  }
  return hash.digest('hex')
}

export function computeHunkId(file: string, status: FileDiffInfo['status'], hunkText: string): string {
  const body = hunkText.split('\n').slice(1).join('\n')
  const digest = createHash('sha256').update(`${file}\0${status}\0${body}`).digest('hex')
  return `h_${digest.slice(0, 12)}`
}

export function computeStopId(hunkIds: string[]): string {
  const digest = createHash('sha256').update([...hunkIds].sort().join('\n')).digest('hex')
  return `s_${digest.slice(0, 12)}`
}

export function computeExplanationKey(modelKey: string, hunkIds: string[]): string {
  const digest = createHash('sha256')
    .update(`${WALKTHROUGH_PROMPT_VERSION}\0${modelKey}\0${[...hunkIds].sort().join('\n')}`)
    .digest('hex')
  return digest
}

function computeModelKey(model: ModelRef | undefined): string {
  return model ? formatOpenCodeModelRef(model) : 'default'
}

function entryKey(sessionId: string, source: WalkthroughSource): string {
  return `${sessionId}\0${walkthroughSourceKey(source)}`
}

function walkthroughTitle(session: SessionInfo, source: WalkthroughSource): string {
  const base = session.title ?? session.id
  return source.kind === 'session' ? base : `${base} — ${describeWalkthroughSource(source)}`
}

function applyReuse(stop: WalkthroughStop, reusable: Map<string, string>, modelKey: string): WalkthroughStop {
  const key = computeExplanationKey(modelKey, stop.hunkIds)
  const explanation = reusable.get(key)
  if (explanation !== undefined) {
    return { ...stop, explanation, status: 'ready', explanationKey: key }
  }
  return stop.status === 'ready' ? { ...stop, explanationKey: key } : stop
}

export function buildWalkthroughPreamble(title: string): string {
  return [
    `You are writing a change walkthrough for a reviewer who reads it top to bottom to understand the change to "${title}".`,
    '## How to write the walkthrough',
    [
      '- Order the stops by the reading order that best explains the change: contracts and data model first, then core logic, then callers and UI, then tests and config.',
      '- Group related hunks, possibly across files.',
    ].join('\n'),
  ].join('\n')
}

export function buildWalkthroughInstructions(title: string): string {
  return [
    buildWalkthroughPreamble(title),
    [
      '- Reference only the hunk ids given below, each at most once.',
      `- Use at most ${WALKTHROUGH_MAX_STOPS} stops.`,
      '- Explain intent and impact rather than restating the code.',
      '- Respond with only the JSON {"summary": string, "stops": [{"title": string, "explanation": string, "hunkIds": string[]}]}.',
    ].join('\n'),
    '## Hunks',
  ].join('\n')
}

function countOutlineChanges(text: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue
    }
    if (line.startsWith('+')) {
      added += 1
    } else if (line.startsWith('-')) {
      removed += 1
    }
  }
  return { added, removed }
}

export function formatHunkOutline(
  hunk: WalkthroughHunk,
  previewLines = WALKTHROUGH_OUTLINE_PREVIEW_LINES,
): string {
  const { added, removed } = countOutlineChanges(hunk.text)
  const head = `### ${hunk.id} ${hunk.file} (${hunk.status}) ${hunk.header} +${added} -${removed}`
  const preview = hunk.text
    .split('\n')
    .filter(
      (line) =>
        (line.startsWith('+') || line.startsWith('-')) &&
        !line.startsWith('+++') &&
        !line.startsWith('---'),
    )
    .slice(0, previewLines)
    .map((line) => truncateText(line, WALKTHROUGH_OUTLINE_LINE_MAX_CHARS, TEXT_TRUNCATION_MARKER).text)
  return [head, ...preview].join('\n')
}

export function formatHunkBlock(hunk: WalkthroughHunk): string {
  return `### ${hunk.id} ${hunk.file} (${hunk.status})\n\n\`\`\`diff\n${hunk.text}\n\`\`\``
}

export function buildWalkthroughInput(changes: FileDiffInfo[]): WalkthroughInput {
  const hunks: WalkthroughHunk[] = []
  const mechanicalHunks: WalkthroughHunk[] = []
  const omittedFiles: WalkthroughOmittedFile[] = []
  const hunkIdCounts = new Map<string, number>()

  const prepareHunks = (change: FileDiffInfo, fileHunks: DiffHunk[]): WalkthroughHunk[] =>
    fileHunks.map((hunk) => {
      const truncated = truncateText(hunk.text, WALKTHROUGH_HUNK_MAX_CHARS, HUNK_TRUNCATION_MARKER)
      const baseId = computeHunkId(change.file, change.status, hunk.text)
      const count = (hunkIdCounts.get(baseId) ?? 0) + 1
      hunkIdCounts.set(baseId, count)
      return {
        id: count === 1 ? baseId : `${baseId}_${count}`,
        file: change.file,
        status: change.status,
        header: hunk.header,
        text: truncated.text,
        truncated: truncated.truncated,
      } satisfies WalkthroughHunk
    })

  changes.forEach((change) => {
    const mechanical = isMechanicalChangePath(change.file)
    const fileHunks = splitDiffHunks(change.patch)
    if (fileHunks.length === 0) {
      omittedFiles.push({ file: change.file, reason: 'binary' })
      return
    }

    if (mechanical) {
      mechanicalHunks.push(...prepareHunks(change, fileHunks))
      return
    }

    hunks.push(...prepareHunks(change, fileHunks))
  })

  return { hunks, mechanicalHunks, omittedFiles }
}

export function buildMechanicalStop(hunks: WalkthroughHunk[]): WalkthroughStop {
  const hunkIds = hunks.map((hunk) => hunk.id)
  return {
    id: computeStopId(hunkIds),
    title: MECHANICAL_STOP_TITLE,
    explanation: MECHANICAL_STOP_EXPLANATION,
    hunkIds,
    status: 'ready',
    explanationKey: null,
  }
}

export function buildWalkthroughPrompt({ title, hunks }: { title: string; hunks: WalkthroughHunk[] }): string {
  const instructions = buildWalkthroughInstructions(title)
  const blocks = hunks.map((hunk) => formatHunkBlock(hunk))

  return [instructions, ...blocks].join('\n\n')
}

export interface WalkthroughOutline {
  hunks: WalkthroughHunk[]
  omittedFiles: WalkthroughOmittedFile[]
  outline: string
}

function groupHunksByFile(hunks: WalkthroughHunk[]): WalkthroughHunk[][] {
  const groups: WalkthroughHunk[][] = []
  for (const hunk of hunks) {
    const last = groups.at(-1)
    if (last && last[0]!.file === hunk.file) {
      last.push(hunk)
    } else {
      groups.push([hunk])
    }
  }
  return groups
}

function buildWalkthroughPlanRules(title: string): string {
  return [
    buildWalkthroughPreamble(title),
    [
      '- Assign every hunk id to exactly one stop.',
      '- Reference each hunk id at most once.',
      `- Use at most ${WALKTHROUGH_MAX_STOPS} stops.`,
      '- Respond with only the JSON {"summary": string, "stops": [{"title": string, "hunkIds": string[]}]}.',
    ].join('\n'),
  ].join('\n')
}

export function buildWalkthroughPlanPrompt({
  title,
  outline,
  previousStops,
}: {
  title: string
  outline: string
  previousStops: Array<{ title: string; hunkIds: string[] }>
}): string {
  const prompt = buildWalkthroughPlanSections(title, outline, previousStops).join('\n\n')
  if (previousStops.length > 0 && prompt.length > WALKTHROUGH_DIFF_MAX_CHARS) {
    return buildWalkthroughPlanSections(title, outline, []).join('\n\n')
  }
  return prompt
}

function buildWalkthroughPlanSections(
  title: string,
  outline: string,
  previousStops: Array<{ title: string; hunkIds: string[] }>,
): string[] {
  const sections = [buildWalkthroughPlanRules(title)]
  if (previousStops.length > 0) {
    sections.push(
      [
        '## Previous stops (keep a grouping when it still explains the change)',
        ...previousStops.map((stop) => `- ${stop.title}: ${stop.hunkIds.join(', ')}`),
      ].join('\n'),
    )
  }
  sections.push(`## Outline\n${outline}`)
  return sections
}

export function buildWalkthroughOutline(input: WalkthroughInput, title: string): WalkthroughOutline {
  const groups = groupHunksByFile(input.hunks)
  const prefixLength = buildWalkthroughPlanRules(title).length + '\n\n## Outline\n'.length

  const pack = (previewLines: number) => {
    let outline = ''
    const hunks: WalkthroughHunk[] = []
    const omittedFiles: WalkthroughOmittedFile[] = []
    let exhausted = false
    for (const fileHunks of groups) {
      if (exhausted) {
        omittedFiles.push({ file: fileHunks[0]!.file, reason: 'budget' })
        continue
      }
      const block = fileHunks.map((hunk) => formatHunkOutline(hunk, previewLines)).join('\n')
      const next = outline.length === 0 ? block : `${outline}\n\n${block}`
      if (prefixLength + next.length > WALKTHROUGH_DIFF_MAX_CHARS) {
        exhausted = true
        omittedFiles.push({ file: fileHunks[0]!.file, reason: 'budget' })
        continue
      }
      outline = next
      hunks.push(...fileHunks)
    }
    return { hunks, omittedFiles, outline }
  }

  let packed = pack(WALKTHROUGH_OUTLINE_PREVIEW_LINES)
  if (packed.hunks.length === 0 && groups.length > 0) {
    packed = pack(0)
  }

  return {
    hunks: packed.hunks,
    omittedFiles: [...input.omittedFiles, ...packed.omittedFiles],
    outline: packed.outline,
  }
}

export function fitsSingleCall(input: WalkthroughInput, title: string): boolean {
  return buildWalkthroughPrompt({ title, hunks: input.hunks }).length <= WALKTHROUGH_DIFF_MAX_CHARS
}

interface ModelStop {
  title: string
  explanation: string
  hunkIds: string[]
}

function parseModelResponse(text: string): { summary: string; stops: ModelStop[] } | null {
  const extracted = extractFirstJsonObject(text)
  if (!extracted) {
    return null
  }

  let raw: unknown
  try {
    raw = JSON.parse(extracted)
  } catch {
    return null
  }

  const parsed = modelResponseSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }

  return parsed.data
}

function collectModelStops(
  modelStops: ModelStop[],
  hunks: WalkthroughHunk[],
  buildStop: (modelStop: ModelStop | null, hunkIds: string[]) => WalkthroughStop,
): WalkthroughStop[] {
  const validIds = new Set(hunks.map((hunk) => hunk.id))
  const referenced = new Set<string>()
  const stops: WalkthroughStop[] = []

  for (const modelStop of modelStops) {
    if (stops.length >= WALKTHROUGH_MAX_STOPS) {
      break
    }

    const hunkIds: string[] = []
    for (const id of modelStop.hunkIds) {
      if (!validIds.has(id) || referenced.has(id)) {
        continue
      }
      referenced.add(id)
      hunkIds.push(id)
    }

    if (hunkIds.length > 0) {
      stops.push(buildStop(modelStop, hunkIds))
    }
  }

  if (stops.length === 0) {
    return stops
  }

  const unreferenced = hunks.filter((hunk) => !referenced.has(hunk.id)).map((hunk) => hunk.id)
  if (unreferenced.length > 0) {
    stops.push(buildStop(null, unreferenced))
  }

  return stops
}

export function parseWalkthroughResponse(text: string, hunks: WalkthroughHunk[]): ParsedWalkthrough | null {
  const parsed = parseModelResponse(text)
  if (!parsed) {
    return null
  }

  const stops = collectModelStops(parsed.stops, hunks, (modelStop, hunkIds) =>
    modelStop
      ? {
          id: computeStopId(hunkIds),
          title: truncateText(modelStop.title, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text,
          explanation: truncateText(modelStop.explanation, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text,
          hunkIds,
          status: 'ready',
          explanationKey: null,
        }
      : {
          id: computeStopId(hunkIds),
          title: REMAINING_STOP_TITLE,
          explanation: REMAINING_STOP_EXPLANATION,
          hunkIds,
          status: 'ready',
          explanationKey: null,
        },
  )

  if (stops.length === 0) {
    return null
  }

  return {
    summary: truncateText(parsed.summary, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text,
    stops,
  }
}

export function parseWalkthroughPlan(text: string, hunks: WalkthroughHunk[]): ParsedWalkthrough | null {
  const parsed = parseModelResponse(text)
  if (!parsed) {
    return null
  }

  const stops = collectModelStops(parsed.stops, hunks, (modelStop, hunkIds) => ({
    id: computeStopId(hunkIds),
    title: modelStop
      ? truncateText(modelStop.title, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text
      : REMAINING_STOP_TITLE,
    explanation: '',
    hunkIds,
    status: 'pending',
    explanationKey: null,
  }))

  if (stops.length === 0) {
    return null
  }

  return {
    summary: truncateText(parsed.summary, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text,
    stops,
  }
}

const explanationSchema = z.object({
  explanation: z.string().catch(''),
})

export function parseWalkthroughExplanation(text: string): string | null {
  const extracted = extractFirstJsonObject(text)
  if (!extracted) {
    return null
  }

  let raw: unknown
  try {
    raw = JSON.parse(extracted)
  } catch {
    return null
  }

  const parsed = explanationSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }

  const explanation = parsed.data.explanation.trim()
  if (explanation.length === 0) {
    return null
  }

  return truncateText(explanation, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text
}

export function buildWalkthroughExplainPrompt({
  title,
  summary,
  stop,
  hunks,
}: {
  title: string
  summary: string
  stop: WalkthroughStop
  hunks: WalkthroughHunk[]
}): string {
  const rule = 'Respond with only the JSON {"explanation": string}.'
  const stopHunks = hunks.filter((hunk) => stop.hunkIds.includes(hunk.id))
  const context = [
    buildWalkthroughPreamble(title),
    `## Walkthrough summary\n${summary}`,
    `## Stop: ${stop.title}`,
  ].join('\n\n')

  const sections = [context]
  let shown = 0

  for (const hunk of stopHunks) {
    const block = formatHunkBlock(hunk)
    const omittedCount = stopHunks.length - shown - 1
    const candidate = [...sections, block, rule]
    if (omittedCount > 0) {
      candidate.push(`${omittedCount} more hunks in this stop are not shown.`)
    }
    if (candidate.join('\n\n').length > WALKTHROUGH_DIFF_MAX_CHARS) {
      break
    }
    sections.push(block)
    shown += 1
  }

  if (shown < stopHunks.length) {
    sections.push(`${stopHunks.length - shown} more hunks in this stop are not shown.`)
  }
  sections.push(rule)
  return sections.join('\n\n')
}

interface InFlightGeneration {
  modelStarted: Promise<void>
  result: Promise<{ walkthrough: ChangeWalkthrough; created: boolean }>
}

function toGenerationError(error: unknown): WalkthroughGenerationError {
  if (error instanceof ServiceError) {
    return {
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    }
  }

  return { message: getErrorMessage(error) || 'Failed to generate the change walkthrough' }
}

export class ChangeWalkthroughService {
  private readonly inFlight = new Map<string, InFlightGeneration>()
  private readonly failures = new Map<string, WalkthroughGenerationError>()
  private readonly deletedDuringGeneration = new Set<string>()
  private readonly currentHashes = new Map<string, string>()
  private readonly hashEpochs = new Map<string, number>()
  private readonly timeoutMs: number

  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly settingsService: SettingsService,
    private readonly gitAuthService: GitAuthService,
    options: ChangeWalkthroughServiceOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async getState(
    sessionId: string,
    source: WalkthroughSource = DEFAULT_WALKTHROUGH_SOURCE,
  ): Promise<ChangeWalkthroughState> {
    const session = await this.readSession(sessionId)
    const key = entryKey(sessionId, source)

    const currentDiffHash = this.inFlight.has(key)
      ? this.currentHashes.get(key) ?? null
      : await this.readCurrentDiffHash(session, source, key)

    const walkthrough = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
    return {
      walkthrough,
      currentDiffHash,
      stale: walkthrough !== null && currentDiffHash !== null && walkthrough.diffHash !== currentDiffHash,
      generating: this.inFlight.has(key),
      error: this.failures.get(key) ?? null,
    }
  }

  private async readCurrentDiffHash(
    session: SessionInfo,
    source: WalkthroughSource,
    key: string,
  ): Promise<string | null> {
    if (source.kind === 'session') {
      const cached = this.currentHashes.get(key)
      if (cached !== undefined) {
        return cached
      }
    }

    const epoch = this.hashEpochs.get(key) ?? 0
    try {
      const changes = await readWalkthroughChanges({
        client: this.openCodeClient,
        session,
        source,
        gitEnv: this.gitAuthService.getGitEnvironment(true),
      })
      const hash = computeChangesHash(changes)
      if ((this.hashEpochs.get(key) ?? 0) === epoch) {
        this.currentHashes.set(key, hash)
      }
      return hash
    } catch {
      return null
    }
  }

  private invalidateCurrentHash(key: string): void {
    this.currentHashes.delete(key)
    this.hashEpochs.set(key, (this.hashEpochs.get(key) ?? 0) + 1)
  }

  generate(
    sessionId: string,
    request: GenerateChangeWalkthroughRequest,
  ): Promise<{ walkthrough: ChangeWalkthrough; created: boolean }> {
    return this.begin(sessionId, request).result
  }

  async startGeneration(sessionId: string, request: GenerateChangeWalkthroughRequest): Promise<ChangeWalkthroughState> {
    const entry = this.begin(sessionId, request)
    await Promise.race([entry.modelStarted, entry.result])
    return this.getState(sessionId, request.source ?? DEFAULT_WALKTHROUGH_SOURCE)
  }

  /** Removes the stored walkthroughs of a deleted session, including one still being generated. */
  handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'session.deleted': {
        const { sessionID } = event.data
        const prefix = `${sessionID}\0`
        for (const key of this.inFlight.keys()) {
          if (key.startsWith(prefix)) {
            this.deletedDuringGeneration.add(key)
          }
        }
        this.clearSessionState(sessionID)
        deleteChangeWalkthroughs(this.db, sessionID)
        return
      }
      case 'session.execution.started':
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted':
        this.invalidateCurrentHash(entryKey(event.data.sessionID, DEFAULT_WALKTHROUGH_SOURCE))
        return
      default:
        return
    }
  }

  private clearSessionState(sessionId: string): void {
    const prefix = `${sessionId}\0`
    const keys = new Set([
      ...this.inFlight.keys(),
      ...this.failures.keys(),
      ...this.currentHashes.keys(),
      ...this.hashEpochs.keys(),
    ])
    for (const key of keys) {
      if (!key.startsWith(prefix)) {
        continue
      }
      this.inFlight.delete(key)
      this.failures.delete(key)
      this.invalidateCurrentHash(key)
    }
  }

  private begin(sessionId: string, request: GenerateChangeWalkthroughRequest): InFlightGeneration {
    const source = request.source ?? DEFAULT_WALKTHROUGH_SOURCE
    const key = entryKey(sessionId, source)
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing
    }

    this.failures.delete(key)

    let resolveModelStarted: () => void = () => {}
    const modelStarted = new Promise<void>((resolve) => {
      resolveModelStarted = resolve
    })
    let modelCalled = false
    const markModelStarted = () => {
      modelCalled = true
      resolveModelStarted()
    }

    const result = this.runGenerate(sessionId, source, request, markModelStarted)
      .catch((error) => {
        if (modelCalled) {
          this.failures.set(key, toGenerationError(error))
        }
        throw error
      })
      .finally(() => {
        this.inFlight.delete(key)
        this.deletedDuringGeneration.delete(key)
        this.invalidateCurrentHash(key)
      })

    result.catch(() => {})

    const entry: InFlightGeneration = { modelStarted, result }
    this.inFlight.set(key, entry)
    return entry
  }

  private async runGenerate(
    sessionId: string,
    source: WalkthroughSource,
    request: GenerateChangeWalkthroughRequest,
    onModelStart: () => void,
  ): Promise<{ walkthrough: ChangeWalkthrough; created: boolean }> {
    const session = await this.readSession(sessionId)
    const key = entryKey(sessionId, source)

    let changes: FileDiffInfo[]
    try {
      changes = await readWalkthroughChanges({
        client: this.openCodeClient,
        session,
        source,
        gitEnv: this.gitAuthService.getGitEnvironment(true),
      })
    } catch (error) {
      if (error instanceof ChangeWalkthroughError) {
        throw error
      }
      throw new ChangeWalkthroughError(getErrorMessage(error) || 'Failed to read session changes', 502, {
        code: 'WALKTHROUGH_CHANGES_UNAVAILABLE',
      })
    }

    if (changes.length === 0) {
      throw new ChangeWalkthroughError('This session has no changes to walk through', 409, {
        code: 'WALKTHROUGH_NO_CHANGES',
      })
    }

    const diffHash = computeChangesHash(changes)
    this.currentHashes.set(key, diffHash)

    const previous = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
    const title = walkthroughTitle(session, source)
    const model = this.resolveWalkthroughModel(session)
    const modelKey = computeModelKey(model)
    const storedModel = model ? formatOpenCodeModelRef(model) : null

    if (previous && previous.diffHash === diffHash && !request.regenerate) {
      if (previous.stops.every((stop) => stop.status === 'ready')) {
        return { walkthrough: previous, created: false }
      }

      const unfinished = previous.stops.filter((stop) => stop.status !== 'ready')
      const resumed = await this.explainStops(
        model,
        title,
        previous.summary,
        unfinished,
        previous.hunks,
        { ...previous, model: storedModel },
        onModelStart,
      )
      if (this.deletedDuringGeneration.has(key)) {
        throw new ChangeWalkthroughError('Session not found', 404)
      }
      return { walkthrough: resumed, created: true }
    }

    const input = buildWalkthroughInput(changes)
    const { hunks, mechanicalHunks, omittedFiles } = input
    if (hunks.length === 0 && mechanicalHunks.length === 0) {
      throw new ChangeWalkthroughError('This session has no text changes to walk through', 409, {
        code: 'WALKTHROUGH_NO_TEXT_CHANGES',
      })
    }

    const mechanicalStop = mechanicalHunks.length > 0 ? buildMechanicalStop(mechanicalHunks) : null

    if (hunks.length === 0) {
      const walkthrough: ChangeWalkthrough = {
        sessionId,
        source,
        diffHash,
        model: storedModel,
        summary: MECHANICAL_ONLY_SUMMARY,
        stops: [mechanicalStop!],
        hunks: mechanicalHunks,
        omittedFiles,
        createdAt: Date.now(),
      }

      if (!this.saveIfSessionLive(walkthrough)) {
        throw new ChangeWalkthroughError('Session not found', 404)
      }
      return { walkthrough, created: true }
    }

    const reusable = new Map<string, string>()
    if (!request.regenerate && previous) {
      for (const stop of previous.stops) {
        if (stop.status === 'ready' && stop.explanationKey) {
          reusable.set(stop.explanationKey, stop.explanation)
        }
      }
    }

    if (fitsSingleCall(input, title)) {
      const prompt = buildWalkthroughPrompt({ title, hunks })
      onModelStart()

      const parsed = await this.callModelParsed(prompt, model, (text) =>
        parseWalkthroughResponse(text, hunks),
      )

      const stops = parsed.stops.map((stop) => applyReuse(stop, reusable, modelKey))
      const walkthrough: ChangeWalkthrough = {
        sessionId,
        source,
        diffHash,
        model: storedModel,
        summary: parsed.summary,
        stops: mechanicalStop ? [...stops, mechanicalStop] : stops,
        hunks: [...hunks, ...mechanicalHunks],
        omittedFiles,
        createdAt: Date.now(),
      }

      if (!this.saveIfSessionLive(walkthrough)) {
        throw new ChangeWalkthroughError('Session not found', 404)
      }
      return { walkthrough, created: true }
    }

    const outline = buildWalkthroughOutline(input, title)
    if (outline.hunks.length === 0) {
      if (!mechanicalStop) {
        throw new ChangeWalkthroughError('These changes are too large to walk through', 413, {
          code: 'WALKTHROUGH_CONTEXT_LIMIT',
          details: { omittedFiles: outline.omittedFiles },
        })
      }

      const walkthrough: ChangeWalkthrough = {
        sessionId,
        source,
        diffHash,
        model: storedModel,
        summary: MECHANICAL_ONLY_SUMMARY,
        stops: [mechanicalStop],
        hunks: mechanicalHunks,
        omittedFiles: outline.omittedFiles,
        createdAt: Date.now(),
      }

      if (!this.saveIfSessionLive(walkthrough)) {
        throw new ChangeWalkthroughError('Session not found', 404)
      }
      return { walkthrough, created: true }
    }

    const outlineIds = new Set(outline.hunks.map((hunk) => hunk.id))
    const previousStops =
      !request.regenerate && previous
        ? previous.stops
            .filter((stop) => stop.hunkIds.length > 0 && stop.hunkIds.every((id) => outlineIds.has(id)))
            .map((stop) => ({ title: stop.title, hunkIds: stop.hunkIds }))
        : []

    const planPrompt = buildWalkthroughPlanPrompt({ title, outline: outline.outline, previousStops })
    onModelStart()

    const planned = await this.callModelParsed(planPrompt, model, (text) =>
      parseWalkthroughPlan(text, outline.hunks),
    )

    const stops = planned.stops.map((stop) => applyReuse(stop, reusable, modelKey))
    let walkthrough: ChangeWalkthrough = {
      sessionId,
      source,
      diffHash,
      model: storedModel,
      summary: planned.summary,
      stops: mechanicalStop ? [...stops, mechanicalStop] : stops,
      hunks: [...outline.hunks, ...mechanicalHunks],
      omittedFiles: outline.omittedFiles,
      createdAt: Date.now(),
    }

    if (!this.saveIfSessionLive(walkthrough)) {
      throw new ChangeWalkthroughError('Session not found', 404)
    }

    const pending = stops.filter((stop) => stop.status !== 'ready')
    if (pending.length > 0) {
      walkthrough = await this.explainStops(
        model,
        title,
        planned.summary,
        pending,
        outline.hunks,
        walkthrough,
        onModelStart,
      )
    }

    if (this.deletedDuringGeneration.has(key)) {
      throw new ChangeWalkthroughError('Session not found', 404)
    }

    return { walkthrough, created: true }
  }

  private async explainStops(
    model: ModelRef | undefined,
    title: string,
    summary: string,
    stops: WalkthroughStop[],
    hunks: WalkthroughHunk[],
    walkthrough: ChangeWalkthrough,
    onModelStart: () => void,
  ): Promise<ChangeWalkthrough> {
    const modelKey = computeModelKey(model)
    let current = walkthrough

    await mapWithConcurrency(stops, WALKTHROUGH_EXPLAIN_CONCURRENCY, async (stop) => {
      const explainPrompt = buildWalkthroughExplainPrompt({ title, summary, stop, hunks })
      onModelStart()

      let explained: WalkthroughStop
      try {
        const explanation = await this.callModelParsed(explainPrompt, model, parseWalkthroughExplanation)
        explained = {
          ...stop,
          explanation,
          status: 'ready',
          explanationKey: computeExplanationKey(modelKey, stop.hunkIds),
        }
      } catch (error) {
        logger.warn('Failed to explain a change walkthrough stop', getErrorMessage(error))
        explained = { ...stop, status: 'failed' }
      }

      current = this.replaceStop(current, explained)
      this.saveIfSessionLive(current)
    })

    return current
  }

  private async callModelParsed<T>(
    prompt: string,
    model: ModelRef | undefined,
    parse: (text: string) => T | null,
  ): Promise<T> {
    let lastError = new ChangeWalkthroughError('Failed to generate the change walkthrough', 502)

    for (let attempt = 0; attempt < WALKTHROUGH_CALL_ATTEMPTS; attempt += 1) {
      let text: string
      try {
        text = await generateTextWithTimeout(this.openCodeClient, { prompt, model }, this.timeoutMs)
      } catch (error) {
        lastError =
          error instanceof GenerateTextTimeoutError
            ? new ChangeWalkthroughError('Generating the change walkthrough timed out', 504, {
                code: 'WALKTHROUGH_TIMEOUT',
              })
            : new ChangeWalkthroughError(
                getErrorMessage(error) || 'Failed to generate the change walkthrough',
                502,
              )
        continue
      }

      const parsed = parse(text)
      if (parsed !== null) {
        return parsed
      }

      lastError = new ChangeWalkthroughError('The model did not return a usable change walkthrough', 502, {
        code: 'WALKTHROUGH_UNPARSEABLE',
      })
    }

    throw lastError
  }

  private replaceStop(walkthrough: ChangeWalkthrough, stop: WalkthroughStop): ChangeWalkthrough {
    return {
      ...walkthrough,
      stops: walkthrough.stops.map((existing) => (existing.id === stop.id ? stop : existing)),
    }
  }

  private saveIfSessionLive(walkthrough: ChangeWalkthrough): boolean {
    if (this.deletedDuringGeneration.has(entryKey(walkthrough.sessionId, walkthrough.source))) {
      return false
    }
    saveChangeWalkthrough(this.db, walkthrough)
    return true
  }

  private async readSession(sessionId: string): Promise<SessionInfo> {
    try {
      return await this.openCodeClient.api.session.get({ sessionID: sessionId })
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        throw new ChangeWalkthroughError('Session not found', 404)
      }
      throw new ChangeWalkthroughError(getErrorMessage(error) || 'Failed to read session', 502)
    }
  }

  private resolveWalkthroughModel(session: SessionInfo): ModelRef | undefined {
    const configured = this.settingsService.getSettings().preferences.walkthroughModel?.trim()
    const parsed = configured ? parseOpenCodeModelRef(configured) : undefined
    return parsed ?? session.model
  }
}
