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
import { getOpenCodeGlobalConfigPath, getOutputsPath } from '@opencode-manager/shared/config/env'
import {
  ChangeSourceSchema,
  OUTPUT_GENERATION_TIMEOUT_MS,
  describeChangeSource,
  outputParamsKey,
  resolveOutputParams,
  type GenerateOutputRequest,
  type OutputDefinition,
  type OutputGenerationError,
  type OutputParams,
  type OutputRecord,
  type OutputState,
  type RefineOutputRequest,
} from '@opencode-manager/shared/schemas'
import {
  claimOutputGeneration,
  deleteSessionOutputDefinitions,
  deleteSessionOutputs,
  getOutput,
  getOutputByGeneratorSession,
  listOutputGeneratorSessionIds,
  listOutputs,
  updateOutput,
  type OutputRecordPatch,
} from '../../db/outputs'
import { getErrorMessage } from '../../utils/error-utils'
import { ServiceError } from '../../utils/service-error'
import { logger } from '../../utils/logger'
import { resolveOpenCodeModel } from '../opencode-models'
import type { OpenCodeClient } from '../opencode/client'
import type { SettingsService } from '../settings'
import type { SSEEvent } from '../sse-aggregator'
import { computeChangesHash } from './change-outline'
import type { OutputDefinitionRegistry } from './definition-registry'
import { OutputError } from './output-error'
import { buildOutputSessionPermissions, buildOutputSessionPrompt } from './output-prompt'
import type { OutputProvider } from './changes-provider'

const OUTPUT_TIMEOUT_MESSAGE = 'The output session did not publish within 15 minutes'
const EMPTY_INPUT_HASH = computeChangesHash([])

export interface OutputServiceOptions {
  generationTimeoutMs?: number
  outputsRoot?: string
}

interface ResolvedOutputEntry {
  definition: OutputDefinition
  params: OutputParams
  paramsKey: string
  key: string
}

interface SettleGenerationOptions {
  interrupt: boolean
}

function toGenerationError(error: unknown): OutputGenerationError {
  if (error instanceof ServiceError) {
    return {
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    }
  }

  return { message: getErrorMessage(error) || 'Failed to generate the output' }
}

export class OutputService {
  private readonly currentHashes = new Map<string, string>()
  private readonly hashEpochs = new Map<string, number>()
  private readonly pendingHashReads = new Map<string, number>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inputSnapshots = new Map<string, FileDiffInfo[]>()
  private readonly entryParams = new Map<string, OutputParams>()
  private readonly generationTimeoutMs: number
  private readonly outputsRoot: string

  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly settingsService: SettingsService,
    private readonly registry: OutputDefinitionRegistry,
    private readonly providers: Record<string, OutputProvider>,
    options: OutputServiceOptions = {},
  ) {
    this.generationTimeoutMs = options.generationTimeoutMs ?? OUTPUT_GENERATION_TIMEOUT_MS
    this.outputsRoot = options.outputsRoot ?? getOutputsPath()
  }

  /** Sessions the output runs were created in, which are helper sessions rather than user sessions. */
  listHelperSessionIds(): string[] {
    return listOutputGeneratorSessionIds(this.db)
  }

  isGeneratorSession(sessionId: string): boolean {
    return getOutputByGeneratorSession(this.db, sessionId) !== null
  }

  async getState(
    sessionId: string,
    definitionId: string,
    params?: OutputParams,
  ): Promise<OutputState> {
    const entry = this.resolveEntry(sessionId, definitionId, params)
    const session = await this.readSession(sessionId)

    let output = getOutput(this.db, sessionId, definitionId, entry.paramsKey)
    if (this.hasGenerationTimedOut(output)) {
      await this.expireGeneration(sessionId, definitionId, entry.params)
      output = getOutput(this.db, sessionId, definitionId, entry.paramsKey)
    }

    const provider = this.providerFor(entry.definition)
    const currentInputHash = await this.readCurrentInputHash(session, entry, provider)
    return {
      definition: entry.definition,
      output,
      currentInputHash,
      hasInput: currentInputHash === null || currentInputHash !== EMPTY_INPUT_HASH,
      stale: output !== null && currentInputHash !== null && output.inputHash !== currentInputHash,
      generating: output?.status === 'generating',
      running: output !== null && output.executionStartedAt !== null,
      error: output?.status === 'failed' ? output.error : null,
    }
  }

  async startGeneration(sessionId: string, request: GenerateOutputRequest): Promise<OutputState> {
    const entry = this.resolveEntry(sessionId, request.definitionId, request.params)
    if (entry.definition.generation === 'currentSession') {
      throw new OutputError('This output is generated in the current session', 409, {
        code: 'OUTPUT_GENERATION_NOT_SUPPORTED',
      })
    }

    const session = await this.readSession(sessionId)
    const provider = this.providerFor(entry.definition)

    let input: FileDiffInfo[] | null = null
    if (provider) {
      await provider.prepare(session, entry.params)
      input = await provider.read(session, entry.params)
      provider.assertUsable(input, entry.params)
    }

    const inputHash = provider && input ? provider.hash(input) : null
    if (inputHash !== null) {
      this.currentHashes.set(entry.key, inputHash)
    }

    const previous = getOutput(this.db, sessionId, request.definitionId, entry.paramsKey)
    if (previous?.status === 'ready' && previous.inputHash === inputHash && !request.regenerate) {
      return this.getState(sessionId, request.definitionId, entry.params)
    }
    if (previous?.status === 'generating' && previous.updatedAt + this.generationTimeoutMs >= Date.now()) {
      return this.getState(sessionId, request.definitionId, entry.params)
    }

    const model = await this.resolveOutputModel(session, request.model)
    const generationId = randomUUID()
    const outputDir = path.join(this.outputsRoot, sessionId, generationId)
    await mkdir(outputDir, { recursive: true })

    const claimed = claimOutputGeneration(this.db, {
      sessionId,
      definitionId: request.definitionId,
      params: entry.params,
      inputHash,
      generationId,
      outputDir,
      model: formatOpenCodeModelRef(model),
      now: Date.now(),
    })
    if (!claimed) {
      await rm(outputDir, { recursive: true, force: true })
      return this.getState(sessionId, request.definitionId, entry.params)
    }

    if (previous?.generatorSessionId) {
      this.inputSnapshots.delete(previous.generatorSessionId)
      await this.interruptOutputSession(
        previous.generatorSessionId,
        'Failed to interrupt the superseded output session',
      )
    }
    if (previous?.outputDir && previous.outputDir !== outputDir) {
      await rm(previous.outputDir, { recursive: true, force: true }).catch((error) => {
        logger.warn('Failed to remove a superseded output generation directory', getErrorMessage(error))
      })
    }

    let generatorSessionId: string | undefined
    try {
      const title = this.outputTitle(session, entry.definition, entry.params)
      const generatorSession = await this.openCodeClient.api.session.create({
        title: `${entry.definition.label} · ${title}`,
        model,
        ...openCodeLocation(session.location.directory),
        permissions: buildOutputSessionPermissions(outputDir),
      })
      generatorSessionId = generatorSession.id

      const recorded = updateOutput(
        this.db,
        { sessionId, definitionId: request.definitionId, paramsKey: entry.paramsKey },
        ['generating'],
        {
          generatorSessionId,
          executionStartedAt: Date.now(),
          updatedAt: Date.now(),
        },
      )
      if (!recorded) {
        this.inputSnapshots.delete(generatorSessionId)
        await this.interruptOutputSession(
          generatorSessionId,
          'Failed to interrupt a cancelled output session',
        )
        await rm(outputDir, { recursive: true, force: true })
        return this.getState(sessionId, request.definitionId, entry.params)
      }

      if (input !== null) {
        this.inputSnapshots.set(generatorSessionId, input)
      }

      await this.openCodeClient.api.session.prompt({
        sessionID: generatorSessionId,
        text: buildOutputSessionPrompt({
          definition: entry.definition,
          title,
          params: entry.params,
          outputDir,
        }),
      })

      const current = getOutput(this.db, sessionId, request.definitionId, entry.paramsKey)
      if (!current || current.status !== 'generating' || current.generatorSessionId !== generatorSessionId) {
        this.inputSnapshots.delete(generatorSessionId)
        await this.interruptOutputSession(
          generatorSessionId,
          'Failed to interrupt a cancelled output session',
        )
        return this.getState(sessionId, request.definitionId, entry.params)
      }

      this.startTimeout(sessionId, request.definitionId, entry.params)
    } catch (error) {
      this.clearTimeout(entry.key)
      if (generatorSessionId) {
        this.inputSnapshots.delete(generatorSessionId)
        await this.interruptOutputSession(
          generatorSessionId,
          'Failed to interrupt a failed output session',
        )
      }
      await rm(outputDir, { recursive: true, force: true })
      const generationError = toGenerationError(error)
      updateOutput(
        this.db,
        { sessionId, definitionId: request.definitionId, paramsKey: entry.paramsKey },
        ['generating'],
        {
          status: 'failed',
          error: generationError,
          executionStartedAt: null,
          updatedAt: Date.now(),
        },
      )
      throw new OutputError(
        generationError.message || 'Failed to start the output session',
        502,
        { code: 'OUTPUT_SESSION_START_FAILED' },
      )
    }

    return this.getState(sessionId, request.definitionId, entry.params)
  }

  async cancelGeneration(sessionId: string, definitionId: string, params?: OutputParams): Promise<boolean> {
    const entry = this.resolveEntry(sessionId, definitionId, params)
    const record = getOutput(this.db, sessionId, definitionId, entry.paramsKey)
    if (!record || (record.status !== 'generating' && record.executionStartedAt === null)) {
      return false
    }
    const updated = await this.settleGeneration(record, { status: 'cancelled' }, { interrupt: true })
    return updated !== null
  }

  async refine(sessionId: string, request: RefineOutputRequest): Promise<OutputState> {
    const entry = this.resolveEntry(sessionId, request.definitionId, request.params)
    if (entry.definition.generation === 'currentSession') {
      throw new OutputError('This output is generated in the current session', 409, {
        code: 'OUTPUT_GENERATION_NOT_SUPPORTED',
      })
    }

    const record = getOutput(this.db, sessionId, request.definitionId, entry.paramsKey)
    if (!record || !record.generatorSessionId) {
      throw new OutputError('The output has not been started yet', 409, {
        code: 'OUTPUT_NOT_STARTED',
      })
    }

    const now = Date.now()
    const claimed = updateOutput(
      this.db,
      { sessionId, definitionId: request.definitionId, paramsKey: entry.paramsKey },
      ['ready', 'failed', 'cancelled'],
      {
        status: 'generating',
        executionStartedAt: now,
        updatedAt: now,
      },
      { running: false },
    )
    if (!claimed) {
      throw new OutputError('The output is still being built', 409, { code: 'OUTPUT_BUSY' })
    }

    const generatorSessionId = record.generatorSessionId
    this.inputSnapshots.delete(generatorSessionId)

    try {
      await this.openCodeClient.api.session.prompt({
        sessionID: generatorSessionId,
        text: [
          request.text,
          `Keep the output in ${record.outputDir ?? ''} and call publish_output again once it is updated.`,
        ].join('\n\n'),
      })
    } catch (error) {
      updateOutput(
        this.db,
        { sessionId, definitionId: request.definitionId, paramsKey: entry.paramsKey },
        ['generating'],
        {
          status: record.status,
          executionStartedAt: null,
          updatedAt: record.updatedAt,
        },
        { generatorSessionId, running: true },
      )
      if (isSessionNotFoundError(error)) {
        throw new OutputError('The output session no longer exists', 409, {
          code: 'OUTPUT_SESSION_MISSING',
        })
      }
      throw new OutputError(getErrorMessage(error) || 'Failed to send the refine prompt', 502)
    }

    this.startTimeout(sessionId, request.definitionId, entry.params)
    return this.getState(sessionId, request.definitionId, entry.params)
  }

  /** Applies session lifecycle events to the stored output records and their output directories. */
  handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'session.deleted': {
        const { sessionID } = event.data
        if (this.failDeletedGeneratorSession(sessionID)) {
          return
        }
        this.clearSessionState(sessionID)
        for (const provider of new Set(Object.values(this.providers))) {
          provider.deleteSessionRefs(sessionID)
        }
        this.interruptSessionOutputs(sessionID)
        deleteSessionOutputs(this.db, sessionID)
        deleteSessionOutputDefinitions(this.db, sessionID)
        void rm(path.join(this.outputsRoot, sessionID), { recursive: true, force: true }).catch((error) => {
          logger.error('Failed to remove a deleted session output directory', error)
        })
        return
      }
      case 'session.execution.started':
        this.invalidateSessionHashes(event.data.sessionID)
        return
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted':
        this.invalidateSessionHashes(event.data.sessionID)
        this.finishGeneratorSession(event.data.sessionID)
        return
      case 'session.revert.staged':
      case 'session.revert.committed':
      case 'session.revert.cleared':
        this.invalidateSessionHashes(event.data.sessionID)
        return
      default:
        return
    }
  }

  private resolveEntry(sessionId: string, definitionId: string, params?: OutputParams): ResolvedOutputEntry {
    const definition = this.registry.get(sessionId, definitionId)
    let resolved: OutputParams
    try {
      resolved = resolveOutputParams(definition, params)
    } catch (error) {
      throw new OutputError(getErrorMessage(error), 400, { code: 'OUTPUT_PARAMS_INVALID' })
    }
    const paramsKey = outputParamsKey(resolved)
    return {
      definition,
      params: resolved,
      paramsKey,
      key: `${sessionId}\0${definitionId}\0${paramsKey}`,
    }
  }

  private outputTitle(session: SessionInfo, definition: OutputDefinition, params: OutputParams): string {
    const base = session.title ?? session.id
    const field = definition.params.find((param) => param.type === 'changeSource')
    if (!field) {
      return base
    }
    const parsed = ChangeSourceSchema.safeParse(params[field.name])
    if (!parsed.success || parsed.data.kind === 'session') {
      return base
    }
    return `${base} — ${describeChangeSource(parsed.data)}`
  }

  private failDeletedGeneratorSession(generatorSessionId: string): boolean {
    const found = getOutputByGeneratorSession(this.db, generatorSessionId)
    if (!found) {
      return false
    }
    const { output } = found
    if (output.status === 'generating' || output.executionStartedAt !== null) {
      void this.settleGeneration(output, {
        status: 'failed',
        error: { message: 'The output session was deleted', code: 'OUTPUT_SESSION_MISSING' },
      }, { interrupt: false }).catch((error) => {
        logger.error('Failed to settle a deleted output session', error)
      })
    }
    this.inputSnapshots.delete(generatorSessionId)
    return true
  }

  private finishGeneratorSession(generatorSessionId: string): void {
    const found = getOutputByGeneratorSession(this.db, generatorSessionId)
    if (!found) {
      return
    }
    const { output } = found
    if (output.status !== 'generating' && output.executionStartedAt === null) {
      return
    }
    void this.settleGeneration(output, {
      status: 'failed',
      error: {
        message: 'The output session finished without publishing an output',
        code: 'OUTPUT_NOT_PUBLISHED',
      },
    }, { interrupt: false }).catch((error) => {
      logger.error('Failed to settle a finished output session', error)
    })
  }

  private interruptSessionOutputs(sessionId: string): void {
    for (const record of listOutputs(this.db, sessionId)) {
      if (record.generatorSessionId) {
        this.inputSnapshots.delete(record.generatorSessionId)
      }
      if ((record.status !== 'generating' && record.executionStartedAt === null) || !record.generatorSessionId) {
        continue
      }
      void this.openCodeClient.api.session.interrupt({ sessionID: record.generatorSessionId }).catch((error) => {
        logger.warn('Failed to interrupt an output session of a deleted session', getErrorMessage(error))
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

  private invalidateSessionHashes(sessionId: string): void {
    const prefix = `${sessionId}\0`
    const keys = new Set([
      ...this.currentHashes.keys(),
      ...this.hashEpochs.keys(),
      ...this.pendingHashReads.keys(),
    ])
    for (const key of keys) {
      if (!key.startsWith(prefix)) {
        continue
      }
      this.invalidateCurrentHash(key)
    }
  }

  private startTimeout(sessionId: string, definitionId: string, params: OutputParams): void {
    const key = `${sessionId}\0${definitionId}\0${outputParamsKey(params)}`
    this.clearTimeout(key)
    this.entryParams.set(key, params)
    const timer = setTimeout(() => {
      this.timers.delete(key)
      const pending = this.entryParams.get(key)
      if (!pending) {
        return
      }
      void this.expireGeneration(sessionId, definitionId, pending).catch((error) => {
        logger.error('Failed to expire an output generation', error)
      })
    }, this.generationTimeoutMs)
    timer.unref?.()
    this.timers.set(key, timer)
  }

  private clearTimeout(key: string): void {
    this.entryParams.delete(key)
    const timer = this.timers.get(key)
    if (timer === undefined) {
      return
    }
    clearTimeout(timer)
    this.timers.delete(key)
  }

  private async expireGeneration(sessionId: string, definitionId: string, params: OutputParams): Promise<void> {
    const entry = this.resolveEntry(sessionId, definitionId, params)
    const record = getOutput(this.db, sessionId, definitionId, entry.paramsKey)
    if (!record || (record.status !== 'generating' && record.executionStartedAt === null)) {
      return
    }
    await this.settleGeneration(record, {
      status: 'failed',
      error: { message: OUTPUT_TIMEOUT_MESSAGE, code: 'OUTPUT_TIMEOUT' },
    }, { interrupt: true })
  }

  private async settleGeneration(
    record: OutputRecord,
    fallbackPatch: OutputRecordPatch,
    options: SettleGenerationOptions,
  ): Promise<OutputRecord | null> {
    const now = Date.now()
    const patch: OutputRecordPatch = record.publishedAt !== null
      ? { status: 'ready', executionStartedAt: null, updatedAt: now }
      : { ...fallbackPatch, executionStartedAt: null, updatedAt: now }
    const key = {
      sessionId: record.sessionId,
      definitionId: record.definitionId,
      paramsKey: record.paramsKey,
    }
    const updated = updateOutput(
      this.db,
      key,
      record.status === 'generating' ? ['generating'] : ['ready', 'failed', 'cancelled'],
      patch,
      {
        ...(record.generatorSessionId ? { generatorSessionId: record.generatorSessionId } : {}),
        ...(record.status === 'generating' ? {} : { running: true }),
      },
    )
    if (record.generatorSessionId) {
      this.inputSnapshots.delete(record.generatorSessionId)
    }
    if (updated) {
      this.clearTimeout(this.entryKey(record.sessionId, record.definitionId, record.paramsKey))
    }
    if (options.interrupt && record.generatorSessionId) {
      await this.interruptOutputSession(record.generatorSessionId, 'Failed to interrupt an output session')
    }
    return updated
  }

  private entryKey(sessionId: string, definitionId: string, paramsKey: string): string {
    return `${sessionId}\0${definitionId}\0${paramsKey}`
  }

  private async interruptOutputSession(generatorSessionId: string, message: string): Promise<void> {
    try {
      await this.openCodeClient.api.session.interrupt({ sessionID: generatorSessionId })
    } catch (error) {
      logger.warn(message, getErrorMessage(error))
    }
  }

  private hasGenerationTimedOut(output: OutputRecord | null): boolean {
    if (!output) {
      return false
    }
    const now = Date.now()
    if (output.status === 'generating' && output.updatedAt + this.generationTimeoutMs < now) {
      return true
    }
    return output.executionStartedAt !== null && output.executionStartedAt + this.generationTimeoutMs < now
  }

  private async readCurrentInputHash(
    session: SessionInfo,
    entry: ResolvedOutputEntry,
    provider: OutputProvider | undefined,
  ): Promise<string | null> {
    if (!provider) {
      return null
    }

    if (provider.cacheable(entry.params)) {
      const cached = this.currentHashes.get(entry.key)
      if (cached !== undefined) {
        return cached
      }
    }

    const epoch = this.hashEpochs.get(entry.key) ?? 0
    this.pendingHashReads.set(entry.key, (this.pendingHashReads.get(entry.key) ?? 0) + 1)
    try {
      const input = await provider.read(session, entry.params)
      const hash = provider.hash(input)
      if ((this.hashEpochs.get(entry.key) ?? 0) === epoch) {
        this.currentHashes.set(entry.key, hash)
      }
      return hash
    } catch {
      return null
    } finally {
      this.releaseHashRead(entry.key)
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

  private providerFor(definition: OutputDefinition): OutputProvider | undefined {
    if (definition.provider === undefined) {
      return undefined
    }
    const provider = this.providers[definition.provider]
    if (!provider) {
      throw new OutputError(
        `Output provider "${definition.provider}" is not available`,
        502,
        { code: 'OUTPUT_PROVIDER_UNAVAILABLE' },
      )
    }
    return provider
  }

  private async readSession(sessionId: string): Promise<SessionInfo> {
    try {
      return await this.openCodeClient.api.session.get({ sessionID: sessionId })
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        throw new OutputError('Session not found', 404)
      }
      throw new OutputError(getErrorMessage(error) || 'Failed to read session', 502)
    }
  }

  /**
   * Resolves the model for the output session, preferring the configured walkthrough model, then the request model,
   * then the target session model. Waits once for OpenCode's lazily-loaded global catalog so an explicit model is
   * registered before the session is created. A failed wait is swallowed because generation proceeds and lets
   * OpenCode surface its own error.
   */
  private async resolveOutputModel(session: SessionInfo, requestModel?: string): Promise<ModelRef> {
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
      throw new OutputError(
        getErrorMessage(error) || 'Failed to resolve the output model',
        502,
        { code: 'OUTPUT_MODEL_UNAVAILABLE' },
      )
    }

    return resolved.variant
      ? { providerID: resolved.providerID, id: resolved.id, variant: resolved.variant }
      : { providerID: resolved.providerID, id: resolved.id }
  }
}
