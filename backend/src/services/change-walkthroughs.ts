import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  isSessionNotFoundError,
  type FileDiffInfo,
  type ModelRef,
  type SessionInfo,
} from '@opencode-manager/shared/opencode'
import {
  WALKTHROUGH_DIFF_MAX_CHARS,
  WALKTHROUGH_HUNK_MAX_CHARS,
  WALKTHROUGH_MAX_STOPS,
  WALKTHROUGH_TEXT_MAX_CHARS,
  type ChangeWalkthrough,
  type ChangeWalkthroughState,
  type GenerateChangeWalkthroughRequest,
  type WalkthroughGenerationError,
  type WalkthroughHunk,
  type WalkthroughOmittedFile,
  type WalkthroughStop,
} from '@opencode-manager/shared/schemas'
import { splitDiffHunks, type DiffHunk } from '@opencode-manager/shared/utils'
import { deleteChangeWalkthrough, getChangeWalkthrough, saveChangeWalkthrough } from '../db/change-walkthroughs'
import { getErrorMessage } from '../utils/error-utils'
import { ServiceError } from '../utils/service-error'
import { truncateText } from '../utils/text-truncate'
import { extractFirstJsonObject } from '../utils/json-extract'
import { GenerateTextTimeoutError, generateTextWithTimeout } from './opencode/generate-text'
import type { OpenCodeClient } from './opencode/client'
import { readSessionChanges } from './session-changes'
import type { SSEEvent } from './sse-aggregator'

const DEFAULT_TIMEOUT_MS = 120_000
const WALKTHROUGH_CALL_ATTEMPTS = 2
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

export class ChangeWalkthroughError extends ServiceError {
  constructor(message: string, status: number, options?: { code?: string; details?: unknown }) {
    super(message, status, options)
    this.name = 'ChangeWalkthroughError'
  }
}

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

export function buildWalkthroughInstructions(title: string): string {
  return [
    `You are writing a change walkthrough for a reviewer who reads it top to bottom to understand the change to "${title}".`,
    '## How to write the walkthrough',
    [
      '- Order the stops by the reading order that best explains the change: contracts and data model first, then core logic, then callers and UI, then tests and config.',
      '- Group related hunks, possibly across files.',
      '- Reference only the hunk ids given below, each at most once.',
      `- Use at most ${WALKTHROUGH_MAX_STOPS} stops.`,
      '- Explain intent and impact rather than restating the code.',
      '- Respond with only the JSON {"summary": string, "stops": [{"title": string, "explanation": string, "hunkIds": string[]}]}.',
    ].join('\n'),
    '## Hunks',
  ].join('\n')
}

export function formatHunkBlock(hunk: WalkthroughHunk): string {
  return `### ${hunk.id} ${hunk.file} (${hunk.status})\n\n\`\`\`diff\n${hunk.text}\n\`\`\``
}

export function buildWalkthroughInput(changes: FileDiffInfo[], title: string): WalkthroughInput {
  const hunks: WalkthroughHunk[] = []
  const mechanicalHunks: WalkthroughHunk[] = []
  const omittedFiles: WalkthroughOmittedFile[] = []
  const hunkIdCounts = new Map<string, number>()
  let total = buildWalkthroughInstructions(title).length
  let budgetExhausted = false

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

    if (!mechanical && budgetExhausted) {
      omittedFiles.push({ file: change.file, reason: 'budget' })
      return
    }

    const fileHunks = splitDiffHunks(change.patch)
    if (fileHunks.length === 0) {
      omittedFiles.push({ file: change.file, reason: 'binary' })
      return
    }

    if (mechanical) {
      mechanicalHunks.push(...prepareHunks(change, fileHunks))
      return
    }

    const prepared = prepareHunks(change, fileHunks)
    const fileTotal = prepared.reduce((sum, hunk) => sum + formatHunkBlock(hunk).length + 2, 0)
    if (total + fileTotal > WALKTHROUGH_DIFF_MAX_CHARS) {
      budgetExhausted = true
      omittedFiles.push({ file: change.file, reason: 'budget' })
      return
    }

    total += fileTotal
    hunks.push(...prepared)
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

export function parseWalkthroughResponse(text: string, hunks: WalkthroughHunk[]): ParsedWalkthrough | null {
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

  const validIds = new Set(hunks.map((hunk) => hunk.id))
  const referenced = new Set<string>()
  const stops: WalkthroughStop[] = []

  for (const modelStop of parsed.data.stops) {
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

    if (hunkIds.length === 0) {
      continue
    }

    stops.push({
      id: computeStopId(hunkIds),
      title: truncateText(modelStop.title, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text,
      explanation: truncateText(modelStop.explanation, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text,
      hunkIds,
      status: 'ready',
      explanationKey: null,
    })
  }

  if (stops.length === 0) {
    return null
  }

  const unreferenced = hunks.filter((hunk) => !referenced.has(hunk.id)).map((hunk) => hunk.id)
  if (unreferenced.length > 0) {
    stops.push({
      id: computeStopId(unreferenced),
      title: REMAINING_STOP_TITLE,
      explanation: REMAINING_STOP_EXPLANATION,
      hunkIds: unreferenced,
      status: 'ready',
      explanationKey: null,
    })
  }

  return {
    summary: truncateText(parsed.data.summary, WALKTHROUGH_TEXT_MAX_CHARS, TEXT_TRUNCATION_MARKER).text,
    stops,
  }
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
  private readonly timeoutMs: number

  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    options: ChangeWalkthroughServiceOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async getState(sessionId: string): Promise<ChangeWalkthroughState> {
    await this.readSession(sessionId)

    const currentDiffHash = this.inFlight.has(sessionId)
      ? this.currentHashes.get(sessionId) ?? null
      : await this.readCurrentDiffHash(sessionId)

    const walkthrough = getChangeWalkthrough(this.db, sessionId)
    return {
      walkthrough,
      currentDiffHash,
      stale: walkthrough !== null && currentDiffHash !== null && walkthrough.diffHash !== currentDiffHash,
      generating: this.inFlight.has(sessionId),
      error: this.failures.get(sessionId) ?? null,
    }
  }

  private async readCurrentDiffHash(sessionId: string): Promise<string | null> {
    const cached = this.currentHashes.get(sessionId)
    if (cached !== undefined) {
      return cached
    }

    try {
      const changes = await readSessionChanges(this.openCodeClient, sessionId)
      const hash = computeChangesHash(changes)
      this.currentHashes.set(sessionId, hash)
      return hash
    } catch {
      return null
    }
  }

  generate(sessionId: string, request: GenerateChangeWalkthroughRequest): Promise<{ walkthrough: ChangeWalkthrough; created: boolean }> {
    return this.begin(sessionId, request).result
  }

  async startGeneration(sessionId: string, request: GenerateChangeWalkthroughRequest): Promise<ChangeWalkthroughState> {
    const entry = this.begin(sessionId, request)
    await Promise.race([entry.modelStarted, entry.result])
    return this.getState(sessionId)
  }

  /** Removes the stored walkthrough of a deleted session, including one still being generated. */
  handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'session.deleted': {
        const { sessionID } = event.data
        if (this.inFlight.has(sessionID)) {
          this.deletedDuringGeneration.add(sessionID)
        }
        this.failures.delete(sessionID)
        this.currentHashes.delete(sessionID)
        deleteChangeWalkthrough(this.db, sessionID)
        return
      }
      case 'session.execution.started':
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted':
        this.currentHashes.delete(event.data.sessionID)
        return
      default:
        return
    }
  }

  private begin(sessionId: string, request: GenerateChangeWalkthroughRequest): InFlightGeneration {
    const existing = this.inFlight.get(sessionId)
    if (existing) {
      return existing
    }

    this.failures.delete(sessionId)

    let resolveModelStarted: () => void = () => {}
    const modelStarted = new Promise<void>((resolve) => {
      resolveModelStarted = resolve
    })
    let modelCalled = false
    const markModelStarted = () => {
      modelCalled = true
      resolveModelStarted()
    }

    const result = this.runGenerate(sessionId, request, markModelStarted)
      .catch((error) => {
        if (modelCalled) {
          this.failures.set(sessionId, toGenerationError(error))
        }
        throw error
      })
      .finally(() => {
        this.inFlight.delete(sessionId)
        this.deletedDuringGeneration.delete(sessionId)
        this.currentHashes.delete(sessionId)
      })

    result.catch(() => {})

    const entry: InFlightGeneration = { modelStarted, result }
    this.inFlight.set(sessionId, entry)
    return entry
  }

  private async runGenerate(
    sessionId: string,
    request: GenerateChangeWalkthroughRequest,
    onModelStart: () => void,
  ): Promise<{ walkthrough: ChangeWalkthrough; created: boolean }> {
    const session = await this.readSession(sessionId)

    let changes: FileDiffInfo[]
    try {
      changes = await readSessionChanges(this.openCodeClient, sessionId)
    } catch (error) {
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
    this.currentHashes.set(sessionId, diffHash)
    const stored = getChangeWalkthrough(this.db, sessionId)
    if (stored && stored.diffHash === diffHash && !request.regenerate) {
      return { walkthrough: stored, created: false }
    }

    const title = session.title ?? sessionId
    const { hunks, mechanicalHunks, omittedFiles } = buildWalkthroughInput(changes, title)
    if (hunks.length === 0 && mechanicalHunks.length === 0) {
      if (omittedFiles.some((file) => file.reason === 'budget')) {
        throw new ChangeWalkthroughError('These changes are too large to walk through', 413, {
          code: 'WALKTHROUGH_CONTEXT_LIMIT',
          details: { omittedFiles },
        })
      }
      throw new ChangeWalkthroughError('This session has no text changes to walk through', 409, {
        code: 'WALKTHROUGH_NO_TEXT_CHANGES',
      })
    }

    const mechanicalStop = mechanicalHunks.length > 0 ? buildMechanicalStop(mechanicalHunks) : null

    if (hunks.length === 0) {
      const walkthrough: ChangeWalkthrough = {
        sessionId,
        diffHash,
        summary: MECHANICAL_ONLY_SUMMARY,
        stops: [mechanicalStop!],
        hunks: mechanicalHunks,
        omittedFiles,
        createdAt: Date.now(),
      }

      if (this.deletedDuringGeneration.has(sessionId)) {
        throw new ChangeWalkthroughError('Session not found', 404)
      }

      saveChangeWalkthrough(this.db, walkthrough)
      return { walkthrough, created: true }
    }

    const prompt = buildWalkthroughPrompt({ title, hunks })

    onModelStart()

    const parsed = await this.callModelParsed(prompt, session.model, (text) =>
      parseWalkthroughResponse(text, hunks),
    )

    const walkthrough: ChangeWalkthrough = {
      sessionId,
      diffHash,
      summary: parsed.summary,
      stops: mechanicalStop ? [...parsed.stops, mechanicalStop] : parsed.stops,
      hunks: [...hunks, ...mechanicalHunks],
      omittedFiles,
      createdAt: Date.now(),
    }

    if (this.deletedDuringGeneration.has(sessionId)) {
      throw new ChangeWalkthroughError('Session not found', 404)
    }

    saveChangeWalkthrough(this.db, walkthrough)
    return { walkthrough, created: true }
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
}
