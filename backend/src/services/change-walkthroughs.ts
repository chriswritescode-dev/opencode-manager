import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  formatOpenCodeModelRef,
  isSessionNotFoundError,
  openCodeLocation,
  parseOpenCodeModelRef,
  type FileDiffInfo,
  type ModelRef,
  type SessionInfo,
} from '@opencode-manager/shared/opencode'
import { getOpenCodeGlobalConfigPath, getWalkthroughsPath } from '@opencode-manager/shared/config/env'
import {
  DEFAULT_WALKTHROUGH_SOURCE,
  WALKTHROUGH_GENERATION_TIMEOUT_MS,
  buildSchedulePermissionRuleset,
  describeWalkthroughSource,
  walkthroughSourceKey,
  type ChangeWalkthrough,
  type ChangeWalkthroughState,
  type GenerateChangeWalkthroughRequest,
  type RefineChangeWalkthroughRequest,
  type SchedulePermissionRuleset,
  type WalkthroughGenerationError,
  type WalkthroughSource,
} from '@opencode-manager/shared/schemas'
import {
  claimChangeWalkthroughGeneration,
  deleteChangeWalkthroughs,
  getChangeWalkthrough,
  getChangeWalkthroughByWalkthroughSession,
  listChangeWalkthroughSessionIds,
  listChangeWalkthroughs,
  updateChangeWalkthrough,
  type ChangeWalkthroughPatch,
} from '../db/change-walkthroughs'
import { getErrorMessage } from '../utils/error-utils'
import { ServiceError } from '../utils/service-error'
import { logger } from '../utils/logger'
import { resolveOpenCodeModel } from './opencode-models'
import type { OpenCodeClient } from './opencode/client'
import { ChangeWalkthroughError } from './change-walkthrough-error'
import {
  buildWalkthroughInput,
  computeChangesHash,
  formatWalkthroughFileChanges,
  formatWalkthroughOutline,
} from './walkthrough-outline'
import { assertHtmlArtifactFile } from './session-artifacts'
import { readWalkthroughChanges, fetchPullRequestRef, deletePullRequestRef } from './walkthrough-sources'
import { resolveRepoForDirectory } from './repo'
import type { GitService } from './git/GitService'
import type { GitAuthService } from './git-auth'
import type { SettingsService } from './settings'
import type { SSEEvent } from './sse-aggregator'

const WALKTHROUGH_TIMEOUT_MESSAGE = 'The walkthrough session did not publish within 15 minutes'
const EMPTY_CHANGES_HASH = computeChangesHash([])

export interface ChangeWalkthroughServiceOptions {
  generationTimeoutMs?: number
  walkthroughsRoot?: string
}

export function buildWalkthroughSessionPermissions(outputDir: string): SchedulePermissionRuleset {
  const normalized = path.resolve(outputDir).replaceAll('\\', '/')
  const ruleset = buildSchedulePermissionRuleset(null)
  ruleset.push({ action: 'edit', resource: '*', effect: 'deny' })
  ruleset.push({ action: 'external_directory', resource: `${normalized}/*`, effect: 'allow' })
  ruleset.push({ action: 'edit', resource: `${normalized}/*`, effect: 'allow' })
  return ruleset
}

export function buildWalkthroughSessionPrompt({
  title,
  sourceDescription,
  artifactPath,
}: {
  title: string
  sourceDescription: string
  artifactPath: string
}): string {
  return [
    `You are building an interactive HTML walkthrough for a reviewer of "${title}" (${sourceDescription}).`,
    '## Getting the changes',
    [
      '- Call the `ocm` tool with the `walkthrough_changes` action to get an outline of the changed files and their hunks.',
      '- Call `walkthrough_changes` again with `{ "file": "<path>" }` to get one changed file\'s full hunks.',
      '- Read surrounding code with the file tools when you need context. Repository edits are denied, so never modify repository files.',
    ].join('\n'),
    '## Reading order',
    [
      '- Order the walkthrough by what best explains the change: contracts and data model first, then core logic, then callers and UI, then tests and config.',
      '- Group related hunks, possibly across files, and explain intent and impact rather than restating the code.',
    ].join('\n'),
    '## Output',
    [
      `- Write one self-contained HTML file at exactly this absolute path: ${artifactPath}`,
      '- Write and update the HTML file with the file write/edit tools, not the shell, because the shell may not be able to reach that path.',
      '- Inline all CSS and JavaScript. Load third-party libraries only from public CDNs. Do not write sibling files.',
      '- Do not use forms, popups, cookies or local storage.',
      '- Show the real diff lines with add/remove styling and a navigable overview of the change.',
    ].join('\n'),
    '## Publishing',
    [
      '- Call the `ocm` tool with the `publish_walkthrough` action as soon as a first version is usable, and again after significant revisions.',
      '- End with a one-paragraph summary reply.',
    ].join('\n'),
  ].join('\n\n')
}

function entryKey(sessionId: string, source: WalkthroughSource): string {
  return `${sessionId}\0${walkthroughSourceKey(source)}`
}

function walkthroughTitle(session: SessionInfo, source: WalkthroughSource): string {
  const base = session.title ?? session.id
  return source.kind === 'session' ? base : `${base} — ${describeWalkthroughSource(source)}`
}

function sourceChangesVerb(source: WalkthroughSource): string {
  return source.kind === 'branch' || source.kind === 'pullRequest' ? 'contains' : 'contain'
}

function noChangesMessage(source: WalkthroughSource): string {
  if (source.kind === 'session') {
    return 'This session has no changes to walk through'
  }
  return `The ${describeWalkthroughSource(source)} ${sourceChangesVerb(source)} no changes to walk through`
}

function noTextChangesMessage(source: WalkthroughSource): string {
  if (source.kind === 'session') {
    return 'This session has no text changes to walk through'
  }
  return `The ${describeWalkthroughSource(source)} ${sourceChangesVerb(source)} no text changes`
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
  private readonly currentHashes = new Map<string, string>()
  private readonly hashEpochs = new Map<string, number>()
  private readonly pendingHashReads = new Map<string, number>()
  private readonly pullRequestRefs = new Map<string, Set<string>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly changesSnapshots = new Map<string, FileDiffInfo[]>()
  private readonly generationTimeoutMs: number
  private readonly walkthroughsRoot: string

  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly settingsService: SettingsService,
    private readonly gitAuthService: GitAuthService,
    private readonly gitService: GitService,
    options: ChangeWalkthroughServiceOptions = {},
  ) {
    this.generationTimeoutMs = options.generationTimeoutMs ?? WALKTHROUGH_GENERATION_TIMEOUT_MS
    this.walkthroughsRoot = options.walkthroughsRoot ?? getWalkthroughsPath()
  }

  /** Sessions the walkthrough runs were created in, which are helper sessions rather than user sessions. */
  listHelperSessionIds(): string[] {
    return listChangeWalkthroughSessionIds(this.db)
  }

  async getState(
    sessionId: string,
    source: WalkthroughSource = DEFAULT_WALKTHROUGH_SOURCE,
  ): Promise<ChangeWalkthroughState> {
    const session = await this.readSession(sessionId)
    const key = entryKey(sessionId, source)

    let walkthrough = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
    if (this.hasGenerationTimedOut(walkthrough)) {
      await this.expireGeneration(sessionId, source)
      walkthrough = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
    }

    const currentDiffHash = await this.readCurrentDiffHash(session, source, key)
    return {
      walkthrough,
      currentDiffHash,
      hasChanges: currentDiffHash === null || currentDiffHash !== EMPTY_CHANGES_HASH,
      stale: walkthrough !== null && currentDiffHash !== null && walkthrough.diffHash !== currentDiffHash,
      generating: walkthrough?.status === 'generating',
      running: walkthrough !== null && walkthrough.executionStartedAt !== null,
      error: walkthrough?.status === 'failed' ? walkthrough.error : null,
    }
  }

  async startGeneration(
    sessionId: string,
    request: GenerateChangeWalkthroughRequest,
  ): Promise<ChangeWalkthroughState> {
    const source = request.source ?? DEFAULT_WALKTHROUGH_SOURCE
    const key = entryKey(sessionId, source)
    const session = await this.readSession(sessionId)

    if (source.kind === 'pullRequest') {
      await this.fetchPullRequestChanges(session, source)
    }

    const changes = await this.readChanges(session, source)

    if (changes.length === 0) {
      throw new ChangeWalkthroughError(noChangesMessage(source), 409, {
        code: 'WALKTHROUGH_NO_CHANGES',
      })
    }

    const input = buildWalkthroughInput(changes)
    if (input.hunks.length === 0 && input.mechanicalHunks.length === 0) {
      throw new ChangeWalkthroughError(noTextChangesMessage(source), 409, {
        code: 'WALKTHROUGH_NO_TEXT_CHANGES',
      })
    }

    const diffHash = computeChangesHash(changes)
    this.currentHashes.set(key, diffHash)

    const previous = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
    if (previous?.status === 'ready' && previous.diffHash === diffHash && !request.regenerate) {
      return this.getState(sessionId, source)
    }
    if (previous?.status === 'generating' && previous.updatedAt + this.generationTimeoutMs >= Date.now()) {
      return this.getState(sessionId, source)
    }

    const model = await this.resolveWalkthroughModel(session, request.model)
    const generationId = randomUUID()
    const outputDir = path.join(this.walkthroughsRoot, sessionId, generationId)
    const artifactPath = path.join(outputDir, 'index.html')
    await mkdir(outputDir, { recursive: true })

    const claimed = claimChangeWalkthroughGeneration(this.db, {
      sessionId,
      source,
      diffHash,
      generationId,
      artifactPath,
      model: formatOpenCodeModelRef(model),
      now: Date.now(),
    })
    if (!claimed) {
      await rm(outputDir, { recursive: true, force: true })
      return this.getState(sessionId, source)
    }

    if (previous?.walkthroughSessionId) {
      this.changesSnapshots.delete(previous.walkthroughSessionId)
      await this.interruptWalkthroughSession(
        previous.walkthroughSessionId,
        'Failed to interrupt the superseded walkthrough session',
      )
    }
    if (previous?.artifactPath) {
      const previousDir = path.dirname(previous.artifactPath)
      if (previousDir !== outputDir) {
        await rm(previousDir, { recursive: true, force: true }).catch((error) => {
          logger.warn('Failed to remove a superseded walkthrough generation directory', getErrorMessage(error))
        })
      }
    }

    let walkthroughSessionId: string | undefined
    try {
      const title = walkthroughTitle(session, source)
      const walkthroughSession = await this.openCodeClient.api.session.create({
        title: `Walkthrough · ${title}`,
        model,
        ...openCodeLocation(session.location.directory),
        permissions: buildWalkthroughSessionPermissions(outputDir),
      })
      walkthroughSessionId = walkthroughSession.id

      const recorded = updateChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source), ['generating'], {
        walkthroughSessionId,
        executionStartedAt: Date.now(),
        updatedAt: Date.now(),
      })
      if (!recorded) {
        this.changesSnapshots.delete(walkthroughSessionId)
        await this.interruptWalkthroughSession(
          walkthroughSessionId,
          'Failed to interrupt a cancelled walkthrough session',
        )
        await rm(outputDir, { recursive: true, force: true })
        return this.getState(sessionId, source)
      }

      this.changesSnapshots.set(walkthroughSessionId, changes)

      await this.openCodeClient.api.session.prompt({
        sessionID: walkthroughSessionId,
        text: buildWalkthroughSessionPrompt({
          title,
          sourceDescription: describeWalkthroughSource(source),
          artifactPath,
        }),
      })

      const current = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
      if (!current || current.status !== 'generating' || current.walkthroughSessionId !== walkthroughSessionId) {
        this.changesSnapshots.delete(walkthroughSessionId)
        await this.interruptWalkthroughSession(
          walkthroughSessionId,
          'Failed to interrupt a cancelled walkthrough session',
        )
        return this.getState(sessionId, source)
      }

      this.startTimeout(sessionId, source)
    } catch (error) {
      this.clearTimeout(entryKey(sessionId, source))
      if (walkthroughSessionId) {
        this.changesSnapshots.delete(walkthroughSessionId)
        await this.interruptWalkthroughSession(
          walkthroughSessionId,
          'Failed to interrupt a failed walkthrough session',
        )
      }
      await rm(outputDir, { recursive: true, force: true })
      const generationError = toGenerationError(error)
      updateChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source), ['generating'], {
        status: 'failed',
        error: generationError,
        executionStartedAt: null,
        updatedAt: Date.now(),
      })
      throw new ChangeWalkthroughError(
        generationError.message || 'Failed to start the walkthrough session',
        502,
        { code: 'WALKTHROUGH_SESSION_START_FAILED' },
      )
    }

    return this.getState(sessionId, source)
  }

  async cancelGeneration(sessionId: string, source: WalkthroughSource = DEFAULT_WALKTHROUGH_SOURCE): Promise<boolean> {
    const record = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
    if (!record || (record.status !== 'generating' && record.executionStartedAt === null)) {
      return false
    }
    const updated = await this.settleGeneration(record, { status: 'cancelled' }, { interrupt: true })
    return updated !== null
  }

  async publishFromWalkthroughSession(walkthroughSessionId: string): Promise<{ path: string }> {
    const { walkthrough } = this.requireWalkthroughSession(walkthroughSessionId)
    const sourceKey = walkthroughSourceKey(walkthrough.source)

    const artifactPath = walkthrough.artifactPath
    if (!artifactPath) {
      throw new ChangeWalkthroughError('The walkthrough has no artifact file yet', 404)
    }
    await assertHtmlArtifactFile(artifactPath, artifactPath)

    const now = Date.now()
    const updated = updateChangeWalkthrough(
      this.db,
      walkthrough.sessionId,
      sourceKey,
      ['generating', 'ready', 'failed'],
      {
        status: 'ready',
        publishedAt: now,
        error: null,
        updatedAt: now,
      },
      { walkthroughSessionId },
    )
    if (!updated) {
      throw new ChangeWalkthroughError('This walkthrough was superseded by a newer generation', 409, {
        code: 'WALKTHROUGH_SUPERSEDED',
      })
    }

    return { path: artifactPath }
  }

  async readChangesForWalkthroughSession(walkthroughSessionId: string, file?: string): Promise<string> {
    const { walkthrough } = this.requireWalkthroughSession(walkthroughSessionId)
    const session = await this.readSession(walkthrough.sessionId)
    const changes = await this.readWalkthroughSessionChanges(walkthroughSessionId, walkthrough, session)

    if (file === undefined) {
      return formatWalkthroughOutline({
        title: walkthroughTitle(session, walkthrough.source),
        sourceDescription: describeWalkthroughSource(walkthrough.source),
        changes,
      })
    }

    const text = formatWalkthroughFileChanges(changes, file)
    if (text === null) {
      throw new ChangeWalkthroughError(`The file is not part of the changes: ${file}`, 404, {
        code: 'WALKTHROUGH_FILE_NOT_CHANGED',
      })
    }
    return text
  }

  async refine(sessionId: string, request: RefineChangeWalkthroughRequest): Promise<ChangeWalkthroughState> {
    const source = request.source ?? DEFAULT_WALKTHROUGH_SOURCE
    const sourceKey = walkthroughSourceKey(source)
    const record = getChangeWalkthrough(this.db, sessionId, sourceKey)
    if (!record || !record.walkthroughSessionId) {
      throw new ChangeWalkthroughError('The walkthrough has not been started yet', 409, {
        code: 'WALKTHROUGH_NOT_STARTED',
      })
    }

    const now = Date.now()
    const claimed = updateChangeWalkthrough(
      this.db,
      sessionId,
      sourceKey,
      ['ready', 'failed', 'cancelled'],
      {
        status: 'generating',
        executionStartedAt: now,
        updatedAt: now,
      },
      { running: false },
    )
    if (!claimed) {
      throw new ChangeWalkthroughError('The walkthrough is still being built', 409, { code: 'WALKTHROUGH_BUSY' })
    }

    this.changesSnapshots.delete(record.walkthroughSessionId)

    const artifactPath = record.artifactPath ?? ''
    try {
      await this.openCodeClient.api.session.prompt({
        sessionID: record.walkthroughSessionId,
        text: [
          request.text,
          `Keep the walkthrough at ${artifactPath} and call publish_walkthrough again once it is updated.`,
        ].join('\n\n'),
      })
    } catch (error) {
      updateChangeWalkthrough(
        this.db,
        sessionId,
        sourceKey,
        ['generating'],
        {
          status: record.status,
          executionStartedAt: null,
          updatedAt: record.updatedAt,
        },
        { walkthroughSessionId: record.walkthroughSessionId, running: true },
      )
      if (isSessionNotFoundError(error)) {
        throw new ChangeWalkthroughError('The walkthrough session no longer exists', 409, {
          code: 'WALKTHROUGH_SESSION_MISSING',
        })
      }
      throw new ChangeWalkthroughError(getErrorMessage(error) || 'Failed to send the refine prompt', 502)
    }

    this.startTimeout(sessionId, source)
    return this.getState(sessionId, source)
  }

  /** Applies session lifecycle events to the stored walkthrough records and their output directories. */
  handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'session.deleted': {
        const { sessionID } = event.data
        if (this.failDeletedWalkthroughSession(sessionID)) {
          return
        }
        this.clearSessionState(sessionID)
        this.deleteSessionPullRequestRefs(sessionID)
        this.interruptSessionWalkthroughs(sessionID)
        deleteChangeWalkthroughs(this.db, sessionID)
        void rm(path.join(this.walkthroughsRoot, sessionID), { recursive: true, force: true }).catch((error) => {
          logger.error('Failed to remove a deleted session walkthrough directory', error)
        })
        return
      }
      case 'session.execution.started':
        this.invalidateCurrentHash(entryKey(event.data.sessionID, DEFAULT_WALKTHROUGH_SOURCE))
        return
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted':
        this.invalidateCurrentHash(entryKey(event.data.sessionID, DEFAULT_WALKTHROUGH_SOURCE))
        this.finishWalkthroughSession(event.data.sessionID)
        return
      case 'session.revert.staged':
      case 'session.revert.committed':
      case 'session.revert.cleared':
        this.invalidateCurrentHash(entryKey(event.data.sessionID, DEFAULT_WALKTHROUGH_SOURCE))
        return
      default:
        return
    }
  }

  private failDeletedWalkthroughSession(walkthroughSessionId: string): boolean {
    const found = getChangeWalkthroughByWalkthroughSession(this.db, walkthroughSessionId)
    if (!found) {
      return false
    }
    const { walkthrough } = found
    if (walkthrough.status === 'generating' || walkthrough.executionStartedAt !== null) {
      void this.settleGeneration(walkthrough, {
        status: 'failed',
        error: { message: 'The walkthrough session was deleted', code: 'WALKTHROUGH_SESSION_MISSING' },
      }, { interrupt: false }).catch((error) => {
        logger.error('Failed to settle a deleted walkthrough session', error)
      })
    }
    this.changesSnapshots.delete(walkthroughSessionId)
    return true
  }

  private finishWalkthroughSession(walkthroughSessionId: string): void {
    const found = getChangeWalkthroughByWalkthroughSession(this.db, walkthroughSessionId)
    if (!found) {
      return
    }
    const { walkthrough } = found
    if (walkthrough.status !== 'generating' && walkthrough.executionStartedAt === null) {
      return
    }
    void this.settleGeneration(walkthrough, {
      status: 'failed',
      error: {
        message: 'The walkthrough session finished without publishing a walkthrough',
        code: 'WALKTHROUGH_NOT_PUBLISHED',
      },
    }, { interrupt: false }).catch((error) => {
      logger.error('Failed to settle a finished walkthrough session', error)
    })
  }

  private interruptSessionWalkthroughs(sessionId: string): void {
    for (const record of listChangeWalkthroughs(this.db, sessionId)) {
      if (record.walkthroughSessionId) {
        this.changesSnapshots.delete(record.walkthroughSessionId)
      }
      if ((record.status !== 'generating' && record.executionStartedAt === null) || !record.walkthroughSessionId) {
        continue
      }
      void this.openCodeClient.api.session.interrupt({ sessionID: record.walkthroughSessionId }).catch((error) => {
        logger.warn('Failed to interrupt a walkthrough session of a deleted session', getErrorMessage(error))
      })
    }
  }

  private clearSessionState(sessionId: string): void {
    const prefix = `${sessionId}\0`
    const keys = new Set([
      ...this.currentHashes.keys(),
      ...this.hashEpochs.keys(),
      ...this.pendingHashReads.keys(),
      ...this.timers.keys(),
    ])
    for (const key of keys) {
      if (!key.startsWith(prefix)) {
        continue
      }
      this.invalidateCurrentHash(key)
      this.clearTimeout(key)
    }
  }

  private startTimeout(sessionId: string, source: WalkthroughSource): void {
    const key = entryKey(sessionId, source)
    this.clearTimeout(key)
    const timer = setTimeout(() => {
      this.timers.delete(key)
      void this.expireGeneration(sessionId, source).catch((error) => {
        logger.error('Failed to expire a change walkthrough generation', error)
      })
    }, this.generationTimeoutMs)
    timer.unref?.()
    this.timers.set(key, timer)
  }

  private clearTimeout(key: string): void {
    const timer = this.timers.get(key)
    if (timer === undefined) {
      return
    }
    clearTimeout(timer)
    this.timers.delete(key)
  }

  private async expireGeneration(sessionId: string, source: WalkthroughSource): Promise<void> {
    const record = getChangeWalkthrough(this.db, sessionId, walkthroughSourceKey(source))
    if (!record || (record.status !== 'generating' && record.executionStartedAt === null)) {
      return
    }
    await this.settleGeneration(record, {
      status: 'failed',
      error: { message: WALKTHROUGH_TIMEOUT_MESSAGE, code: 'WALKTHROUGH_TIMEOUT' },
    }, { interrupt: true })
  }

  private async settleGeneration(
    record: ChangeWalkthrough,
    fallbackPatch: ChangeWalkthroughPatch,
    options: { interrupt: boolean },
  ): Promise<ChangeWalkthrough | null> {
    const now = Date.now()
    const patch: ChangeWalkthroughPatch = record.publishedAt !== null
      ? { status: 'ready', executionStartedAt: null, updatedAt: now }
      : { ...fallbackPatch, executionStartedAt: null, updatedAt: now }
    const updated = updateChangeWalkthrough(
      this.db,
      record.sessionId,
      walkthroughSourceKey(record.source),
      record.status === 'generating' ? ['generating'] : ['ready', 'failed', 'cancelled'],
      patch,
      {
        ...(record.walkthroughSessionId ? { walkthroughSessionId: record.walkthroughSessionId } : {}),
        ...(record.status === 'generating' ? {} : { running: true }),
      },
    )
    if (record.walkthroughSessionId) {
      this.changesSnapshots.delete(record.walkthroughSessionId)
    }
    if (updated) {
      this.clearTimeout(entryKey(record.sessionId, record.source))
    }
    if (options.interrupt && record.walkthroughSessionId) {
      await this.interruptWalkthroughSession(record.walkthroughSessionId, 'Failed to interrupt a walkthrough session')
    }
    return updated
  }

  private async interruptWalkthroughSession(walkthroughSessionId: string, message: string): Promise<void> {
    try {
      await this.openCodeClient.api.session.interrupt({ sessionID: walkthroughSessionId })
    } catch (error) {
      logger.warn(message, getErrorMessage(error))
    }
  }

  private requireWalkthroughSession(
    walkthroughSessionId: string,
  ): { walkthrough: ChangeWalkthrough; generationId: string } {
    const found = getChangeWalkthroughByWalkthroughSession(this.db, walkthroughSessionId)
    if (!found) {
      throw new ChangeWalkthroughError('This session is not a walkthrough session', 404, {
        code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION',
      })
    }
    return found
  }

  private hasGenerationTimedOut(walkthrough: ChangeWalkthrough | null): boolean {
    if (!walkthrough) {
      return false
    }
    const now = Date.now()
    if (walkthrough.status === 'generating' && walkthrough.updatedAt + this.generationTimeoutMs < now) {
      return true
    }
    return walkthrough.executionStartedAt !== null && walkthrough.executionStartedAt + this.generationTimeoutMs < now
  }

  private async readWalkthroughSessionChanges(
    walkthroughSessionId: string,
    walkthrough: ChangeWalkthrough,
    session: SessionInfo,
  ): Promise<FileDiffInfo[]> {
    const snapshot = this.changesSnapshots.get(walkthroughSessionId)
    if (snapshot) {
      return snapshot
    }
    const executionStartedAt = walkthrough.executionStartedAt
    const changes = await this.readChanges(session, walkthrough.source)
    if (executionStartedAt !== null) {
      const current = getChangeWalkthroughByWalkthroughSession(this.db, walkthroughSessionId)
      if (current?.walkthrough.executionStartedAt === executionStartedAt) {
        this.changesSnapshots.set(walkthroughSessionId, changes)
      }
    }
    return changes
  }

  private async readChanges(session: SessionInfo, source: WalkthroughSource): Promise<FileDiffInfo[]> {
    try {
      return await readWalkthroughChanges({
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
    this.pendingHashReads.set(key, (this.pendingHashReads.get(key) ?? 0) + 1)
    try {
      const changes = await this.readChanges(session, source)
      const hash = computeChangesHash(changes)
      if ((this.hashEpochs.get(key) ?? 0) === epoch) {
        this.currentHashes.set(key, hash)
      }
      return hash
    } catch {
      return null
    } finally {
      this.releaseHashRead(key)
    }
  }

  private invalidateCurrentHash(key: string): void {
    this.currentHashes.delete(key)
    if ((this.pendingHashReads.get(key) ?? 0) > 0) {
      this.hashEpochs.set(key, (this.hashEpochs.get(key) ?? 0) + 1)
      return
    }
    this.hashEpochs.delete(key)
  }

  private releaseHashRead(key: string): void {
    const remaining = (this.pendingHashReads.get(key) ?? 1) - 1
    if (remaining > 0) {
      this.pendingHashReads.set(key, remaining)
      return
    }
    this.pendingHashReads.delete(key)
    if (!this.currentHashes.has(key)) {
      this.hashEpochs.delete(key)
    }
  }

  private recordPullRequestRef(sessionId: string, directory: string, ref: string): void {
    const entry = `${directory}\0${ref}`
    const existing = this.pullRequestRefs.get(sessionId)
    if (existing) {
      existing.add(entry)
      return
    }
    this.pullRequestRefs.set(sessionId, new Set([entry]))
  }

  private deleteSessionPullRequestRefs(sessionId: string): void {
    const entries = this.pullRequestRefs.get(sessionId)
    if (!entries) {
      return
    }
    this.pullRequestRefs.delete(sessionId)
    const gitEnv = this.gitAuthService.getGitEnvironment(true)
    for (const entry of entries) {
      const separator = entry.indexOf('\0')
      const directory = entry.slice(0, separator)
      const ref = entry.slice(separator + 1)
      void deletePullRequestRef(directory, ref, gitEnv).catch(() => {})
    }
  }

  private async fetchPullRequestChanges(
    session: SessionInfo,
    source: Extract<WalkthroughSource, { kind: 'pullRequest' }>,
  ): Promise<void> {
    const directory = session.location.directory
    const repo = await resolveRepoForDirectory(this.db, directory)
    const target = repo
      ? { id: repo.id, repoUrl: repo.repoUrl, fullPath: repo.fullPath }
      : { fullPath: directory }
    const refs = await fetchPullRequestRef(
      directory,
      session.id,
      source,
      this.gitAuthService.getGitEnvironment(true),
      (remote, refspecs, timeoutMs) =>
        this.gitService.fetchRemoteRef(target, remote, refspecs, this.db, timeoutMs),
    )
    for (const ref of refs) {
      this.recordPullRequestRef(session.id, directory, ref)
    }
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

  /**
   * Resolves the model for the walkthrough session, preferring the configured walkthrough model, then the request
   * model, then the target session model. Waits once for OpenCode's lazily-loaded global catalog so an explicit model
   * is registered before the session is created. A failed wait is swallowed because generation proceeds and lets
   * OpenCode surface its own error.
   */
  private async resolveWalkthroughModel(session: SessionInfo, requestModel?: string): Promise<ModelRef> {
    const configured = this.settingsService.getSettings().preferences.walkthroughModel?.trim()
    const parsedConfigured = configured ? parseOpenCodeModelRef(configured) : undefined
    const parsedRequest = requestModel ? parseOpenCodeModelRef(requestModel) : undefined
    const preferred = parsedConfigured ?? parsedRequest ?? session.model
    if (preferred) {
      try {
        await resolveOpenCodeModel(this.openCodeClient, getOpenCodeGlobalConfigPath(), {
          preferredModel: formatOpenCodeModelRef(preferred),
        })
      } catch {
        return preferred
      }
      return preferred
    }

    let resolved
    try {
      resolved = await resolveOpenCodeModel(this.openCodeClient, getOpenCodeGlobalConfigPath())
    } catch (error) {
      throw new ChangeWalkthroughError(
        getErrorMessage(error) || 'Failed to resolve the walkthrough model',
        502,
        { code: 'WALKTHROUGH_MODEL_UNAVAILABLE' },
      )
    }

    return resolved.variant
      ? { providerID: resolved.providerID, id: resolved.id, variant: resolved.variant }
      : { providerID: resolved.providerID, id: resolved.id }
  }
}
