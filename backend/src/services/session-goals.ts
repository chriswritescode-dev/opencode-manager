import type { Database } from 'bun:sqlite'
import {
  DEFAULT_SESSION_DEFAULTS,
  LOCAL_OPENCODE_SERVER_ID,
  type SessionGoal,
  type SessionGoalStatus,
  type SessionGoalStopReason,
  type SessionGoalTurnState,
  type SessionLockReason,
  type StartSessionGoalRequest,
} from '@opencode-manager/shared/schemas'
import {
  isSessionNotFoundError,
  parseOpenCodeModelRef,
  sessionIDFromEvent,
  type ModelRef,
} from '@opencode-manager/shared/opencode'
import {
  getLatestSessionGoal,
  getSessionGoalById,
  insertSessionGoal,
  listOpenSessionGoals,
  transitionSessionGoal,
  type SessionGoalPatch,
  type SessionGoalRecord,
} from '../db/session-goals'
import { logger } from '../utils/logger'
import {
  buildGoalAuditPrompt,
  buildGoalContinuationPrompt,
  GOAL_AUDIT_UNPARSED_REASON,
  parseGoalVerdict,
  type GoalVerdict,
} from './session-goal-audit'
import { isSessionBusy, readLatestAssistantReply, type AssistantReplyState } from './session-reply'
import type { OpenCodeClient } from './opencode/client'
import type { SettingsService } from './settings'
import type { SSEEvent } from './sse-aggregator'

const DEFAULT_QUIET_MS = 3000
const BLOCKED_LIMIT = 3
const AUDITOR_ATTEMPTS = 2
const RECOVERY_RETRY_MS = 5000

type PrerequisiteResult<T> = { ok: true; value: T } | { ok: false }

export interface SessionServerRegistry {
  getClient(serverId: string): OpenCodeClient
  get(serverId: string): { enabled: boolean } | null
}

export type SessionServerSource = OpenCodeClient | SessionServerRegistry

export interface SessionGoalServiceOptions {
  quietMs?: number
  onOutcome?: (goal: SessionGoal) => void
  resolveSessionLock?: (sessionId: string, serverId: string) => Promise<SessionLockReason | null>
}

export class SessionGoalError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function sessionTokenTotal(tokens: { input: number; output: number; reasoning: number }): number {
  return tokens.input + tokens.output + tokens.reasoning
}

function goalKey(serverId: string, sessionId: string): string {
  return `${serverId}:${sessionId}`
}

function isServerRegistry(source: SessionServerSource): source is SessionServerRegistry {
  return typeof (source as SessionServerRegistry).getClient === 'function'
}

function toServerRegistry(source: SessionServerSource): SessionServerRegistry {
  if (isServerRegistry(source)) {
    return source
  }
  return {
    getClient: () => source,
    get: (serverId) => (serverId === LOCAL_OPENCODE_SERVER_ID ? { enabled: true } : null),
  }
}

function toSessionGoal(record: SessionGoalRecord): SessionGoal {
  return {
    id: record.id,
    sessionId: record.sessionId,
    serverId: record.serverId,
    directory: record.directory,
    objective: record.objective,
    status: record.status,
    stopReason: record.stopReason,
    turnState: record.turnState,
    continuationCount: record.continuationCount,
    maxContinuations: record.maxContinuations,
    tokenBudget: record.tokenBudget,
    tokensUsed: record.tokensUsed,
    consecutiveBlocked: record.consecutiveBlocked,
    lastVerdict: record.lastVerdict,
    lastReason: record.lastReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
  }
}

export class SessionGoalService {
  private readonly goalBySession = new Map<string, number>()
  private readonly auditTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly auditing = new Set<number>()
  private readonly auditRequested = new Set<number>()
  private readonly auditGeneration = new Map<string, number>()
  private readonly servers: SessionServerRegistry
  private readonly quietMs: number
  private readonly onOutcome: (goal: SessionGoal) => void
  private readonly resolveSessionLock: (sessionId: string, serverId: string) => Promise<SessionLockReason | null>

  constructor(
    private readonly db: Database,
    servers: SessionServerSource,
    private readonly settingsService: SettingsService,
    options: SessionGoalServiceOptions = {},
  ) {
    this.servers = toServerRegistry(servers)
    this.quietMs = options.quietMs ?? DEFAULT_QUIET_MS
    this.onOutcome = options.onOutcome ?? (() => {})
    this.resolveSessionLock = options.resolveSessionLock ?? (async () => null)
  }

  loadOpenGoals(): void {
    this.goalBySession.clear()
    for (const record of listOpenSessionGoals(this.db)) {
      this.goalBySession.set(goalKey(record.serverId, record.sessionId), record.id)
    }
  }

  async recoverOpenGoals(): Promise<void> {
    for (const record of listOpenSessionGoals(this.db)) {
      if (record.status !== 'active' || record.turnState !== 'running') {
        continue
      }
      if (!this.isServerAvailable(record.serverId)) {
        continue
      }
      try {
        await this.recoverRunningGoal(record)
      } catch (error) {
        logger.error(`Session goal recovery failed for goal ${record.id}:`, error)
      }
    }
  }

  private async recoverRunningGoal(record: SessionGoalRecord): Promise<void> {
    const key = goalKey(record.serverId, record.sessionId)
    const generation = this.currentAuditGeneration(key)
    const client = this.servers.getClient(record.serverId)
    try {
      await client.api.session.get({ sessionID: record.sessionId })
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        this.finishGoal(record.id, 'stopped', 'session_deleted')
        return
      }
      logger.error(`Session goal recovery could not read session ${record.sessionId}:`, error)
      this.scheduleRecoveryRetry(key, record.id, generation)
      return
    }

    const busy = await this.readPrerequisite(record.id, 'busy check', () =>
      isSessionBusy(client, record.sessionId),
    )
    if (!busy.ok) {
      this.scheduleRecoveryRetry(key, record.id, generation)
      return
    }
    if (busy.value) {
      return
    }
    this.scheduleAudit(key, record.id, 0)
  }

  private isServerAvailable(serverId: string): boolean {
    if (serverId === LOCAL_OPENCODE_SERVER_ID) {
      return true
    }
    try {
      const server = this.servers.get(serverId)
      return Boolean(server?.enabled)
    } catch (error) {
      logger.error(`Failed to resolve OpenCode server ${serverId}:`, error)
      return false
    }
  }

  private scheduleRecoveryRetry(key: string, goalId: number, generation: number): void {
    this.clearRecoveryTimer(key)
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(key)
      void this.retryRecovery(key, goalId, generation).catch((error) => {
        logger.error(`Session goal recovery retry failed for goal ${goalId}:`, error)
      })
    }, RECOVERY_RETRY_MS)
    this.recoveryTimers.set(key, timer)
  }

  private async retryRecovery(key: string, goalId: number, generation: number): Promise<void> {
    const record = getSessionGoalById(this.db, goalId)
    if (!record || record.status !== 'active' || record.turnState !== 'running') {
      return
    }
    if (!this.isServerAvailable(record.serverId)) {
      return
    }
    if (this.currentAuditGeneration(key) !== generation) {
      return
    }
    await this.recoverRunningGoal(record)
  }

  private clearRecoveryTimer(key: string): void {
    const timer = this.recoveryTimers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.recoveryTimers.delete(key)
    }
  }

  async start(input: StartSessionGoalRequest): Promise<SessionGoal> {
    const serverId = input.serverId ?? LOCAL_OPENCODE_SERVER_ID
    await this.assertSessionCanStartGoal(input.sessionId, serverId)

    const defaults = this.settingsService.getSettings().preferences.sessionDefaults
    const maxContinuations =
      input.maxContinuations ?? defaults?.goalMaxContinuations ?? DEFAULT_SESSION_DEFAULTS.goalMaxContinuations
    const tokenBudget = input.tokenBudget ?? defaults?.goalTokenBudget ?? null
    const tokensAtStart = await this.readSessionTokenTotalOrDefault(input.sessionId, serverId)

    const record = insertSessionGoal(this.db, {
      sessionId: input.sessionId,
      serverId,
      directory: input.directory,
      objective: input.objective,
      maxContinuations,
      tokenBudget,
      tokensAtStart,
    })

    if (!record) {
      throw new SessionGoalError('This session already has an open goal', 409)
    }

    this.goalBySession.set(goalKey(record.serverId, record.sessionId), record.id)
    return toSessionGoal(record)
  }

  getLatest(sessionId: string, serverId: string = LOCAL_OPENCODE_SERVER_ID): SessionGoal | null {
    const record = getLatestSessionGoal(this.db, sessionId, serverId)
    return record ? toSessionGoal(record) : null
  }

  private async assertSessionCanStartGoal(sessionId: string, serverId: string): Promise<void> {
    let lock: SessionLockReason | null
    try {
      lock = await this.resolveSessionLock(sessionId, serverId)
    } catch (error) {
      logger.error(`Failed to resolve session lock for ${sessionId}:`, error)
      return
    }

    if (lock === 'schedule') {
      throw new SessionGoalError('Scheduled runs cannot run goals', 409)
    }
    if (lock === 'child') {
      throw new SessionGoalError('Goals can only be started on top-level sessions', 400)
    }
  }

  pause(id: number): SessionGoal {
    return this.transitionWithOutcome(id, ['active'], { status: 'paused', stopReason: 'user_paused' })
  }

  resume(id: number): SessionGoal {
    const record = this.transition(id, ['paused'], {
      status: 'active',
      stopReason: null,
      turnState: 'running',
      finishedAt: null,
    })

    const goal = toSessionGoal(record)
    void this.scheduleAuditWhenIdle(goal)
    return goal
  }

  cancel(id: number): SessionGoal {
    return this.transitionWithOutcome(id, ['active', 'paused'], {
      status: 'stopped',
      stopReason: 'cancelled',
      finishedAt: Date.now(),
    })
  }

  async handleEvent(
    directory: string | null,
    event: SSEEvent,
    serverId: string = LOCAL_OPENCODE_SERVER_ID,
  ): Promise<void> {
    const sessionId = sessionIDFromEvent(event)
    if (!sessionId) {
      return
    }

    const key = goalKey(serverId, sessionId)
    const goalId = this.goalBySession.get(key)
    if (goalId === undefined) {
      return
    }

    switch (event.type) {
      case 'session.execution.started':
        this.clearAuditTimer(key)
        this.applyTransition(goalId, ['active'], { turnState: 'running' })
        return
      case 'session.idle':
      case 'session.execution.succeeded':
        this.scheduleAuditFromEvent(key, goalId)
        return
      case 'session.status':
        if (event.data.status.type === 'idle') {
          this.scheduleAuditFromEvent(key, goalId)
        }
        return
      case 'session.execution.failed':
        this.clearAuditTimer(key)
        this.finishGoal(goalId, 'stopped', 'turn_error')
        return
      case 'session.execution.interrupted':
        this.clearAuditTimer(key)
        this.finishGoal(goalId, 'paused', 'interrupted')
        return
      case 'session.deleted':
        this.clearAuditTimer(key)
        this.finishGoal(goalId, 'stopped', 'session_deleted', ['active', 'paused'])
        return
      default:
        return
    }
  }

  private scheduleAuditFromEvent(key: string, goalId: number): void {
    const record = getSessionGoalById(this.db, goalId)
    if (!record || record.status !== 'active' || record.turnState !== 'running') {
      return
    }
    this.scheduleAudit(key, goalId, this.quietMs)
  }

  private async scheduleAuditWhenIdle(goal: SessionGoal): Promise<void> {
    const key = goalKey(goal.serverId, goal.sessionId)
    const generation = this.currentAuditGeneration(key)
    const busy = await this.readPrerequisite(goal.id, 'busy check', () =>
      isSessionBusy(this.servers.getClient(goal.serverId), goal.sessionId),
    )

    if (!busy.ok) {
      this.failAudit(goal.id, key, generation)
      return
    }
    if (!this.isAuditCurrent(goal.id, key, generation)) {
      return
    }
    if (busy.value) {
      return
    }
    this.scheduleAudit(key, goal.id, 0)
  }

  private scheduleAudit(key: string, goalId: number, delay: number): void {
    this.clearRecoveryTimer(key)
    this.clearAuditTimer(key)
    const timer = setTimeout(() => {
      this.auditTimers.delete(key)
      void this.runAudit(goalId).catch((error) => {
        logger.error(`Session goal audit failed for goal ${goalId}:`, error)
      })
    }, delay)
    this.auditTimers.set(key, timer)
  }

  private clearAuditTimer(key: string): void {
    const timer = this.auditTimers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.auditTimers.delete(key)
    }
  }

  private async runAudit(goalId: number): Promise<void> {
    if (this.auditing.has(goalId)) {
      this.auditRequested.add(goalId)
      return
    }

    this.auditing.add(goalId)
    try {
      let pending = true
      while (pending) {
        this.auditRequested.delete(goalId)
        await this.performAudit(goalId)
        pending = this.auditRequested.has(goalId)
      }
    } finally {
      this.auditing.delete(goalId)
    }
  }

  private async performAudit(goalId: number): Promise<void> {
    const goal = getSessionGoalById(this.db, goalId)
    if (!goal || goal.status !== 'active' || goal.turnState !== 'running') {
      return
    }

    const sessionId = goal.sessionId
    const key = goalKey(goal.serverId, sessionId)
    const generation = this.currentAuditGeneration(key)
    const client = this.servers.getClient(goal.serverId)

    const busy = await this.readPrerequisite(goalId, 'busy check', () =>
      isSessionBusy(client, sessionId),
    )
    if (!busy.ok) {
      this.failAudit(goalId, key, generation)
      return
    }
    if (!this.isAuditCurrent(goalId, key, generation) || busy.value) {
      return
    }

    const total = await this.readPrerequisite(goalId, 'token read', () =>
      this.readSessionTokenTotal(sessionId, goal.serverId),
    )
    if (!total.ok) {
      this.failAudit(goalId, key, generation)
      return
    }
    if (!this.isAuditCurrent(goalId, key, generation)) {
      return
    }

    const tokensUsed = Math.max(0, total.value - goal.tokensAtStart)
    const updated = this.applyTransition(goalId, ['active'], { tokensUsed })
    if (!updated) {
      return
    }

    if (updated.tokenBudget !== null && tokensUsed >= updated.tokenBudget) {
      this.finishGoal(goalId, 'stopped', 'token_budget')
      return
    }

    const reply = await this.readPrerequisite(goalId, 'reply read', () =>
      readLatestAssistantReply(client, sessionId),
    )
    if (!reply.ok) {
      this.failAudit(goalId, key, generation)
      return
    }
    if (!this.isAuditCurrent(goalId, key, generation)) {
      return
    }

    if (reply.value?.errorText) {
      this.finishGoal(goalId, 'stopped', 'turn_error')
      return
    }

    const verdict = await this.evaluateAudit(updated, reply.value)
    if (!this.isAuditCurrent(goalId, key, generation)) {
      return
    }
    if (!verdict) {
      this.finishGoal(goalId, 'paused', 'audit_failed')
      return
    }

    await this.applyVerdict(goalId, key, generation, updated, verdict)
  }

  private async evaluateAudit(goal: SessionGoalRecord, reply: AssistantReplyState | null): Promise<GoalVerdict | null> {
    const prompt = buildGoalAuditPrompt({ objective: goal.objective, reply: reply?.responseText ?? null })
    const model = this.resolveAuditorModel()
    const localClient = this.servers.getClient(LOCAL_OPENCODE_SERVER_ID)

    for (let attempt = 0; attempt < AUDITOR_ATTEMPTS; attempt += 1) {
      try {
        const result = await localClient.api.generate.text(model ? { prompt, model } : { prompt })
        return parseGoalVerdict(result.text) ?? { verdict: 'continue', reason: GOAL_AUDIT_UNPARSED_REASON }
      } catch (error) {
        logger.error(`Goal auditor call failed for goal ${goal.id} (attempt ${attempt + 1}):`, error)
      }
    }

    return null
  }

  private resolveAuditorModel(): ModelRef | undefined {
    const configured = this.settingsService.getSettings().preferences.sessionDefaults?.goalAuditorModel
    return configured ? parseOpenCodeModelRef(configured) : undefined
  }

  private async applyVerdict(
    goalId: number,
    key: string,
    generation: number,
    goal: SessionGoalRecord,
    verdict: GoalVerdict,
  ): Promise<void> {
    if (!this.isAuditCurrent(goalId, key, generation)) {
      return
    }

    if (verdict.verdict === 'done') {
      this.finishGoal(goalId, 'completed', null, ['active'], {
        lastVerdict: 'done',
        lastReason: verdict.reason,
      })
      return
    }

    if (verdict.verdict === 'blocked') {
      const consecutiveBlocked = goal.consecutiveBlocked + 1
      const patch: SessionGoalPatch = {
        consecutiveBlocked,
        lastVerdict: 'blocked',
        lastReason: verdict.reason,
      }

      if (consecutiveBlocked >= BLOCKED_LIMIT) {
        this.finishGoal(goalId, 'blocked', null, ['active'], patch)
        return
      }

      await this.continueGoal(goalId, key, generation, goal, verdict.reason, patch)
      return
    }

    await this.continueGoal(goalId, key, generation, goal, verdict.reason, {
      consecutiveBlocked: 0,
      lastVerdict: 'continue',
      lastReason: verdict.reason,
    })
  }

  private async continueGoal(
    goalId: number,
    key: string,
    generation: number,
    goal: SessionGoalRecord,
    reason: string,
    patch: SessionGoalPatch,
  ): Promise<void> {
    if (!this.isAuditCurrent(goalId, key, generation)) {
      return
    }

    if (goal.continuationCount >= goal.maxContinuations) {
      this.finishGoal(goalId, 'stopped', 'continuation_limit', ['active'], patch)
      return
    }

    const record = this.applyTransition(goalId, ['active'], {
      ...patch,
      continuationCount: goal.continuationCount + 1,
      turnState: 'waiting',
    })
    if (!record) {
      return
    }

    try {
      await this.servers.getClient(record.serverId).api.session.prompt({
        sessionID: record.sessionId,
        text: buildGoalContinuationPrompt({ objective: record.objective, reason }),
      })
    } catch (error) {
      logger.error(`Failed to send continuation for goal ${goalId}:`, error)
      if (this.isAuditCurrent(goalId, key, generation, 'waiting')) {
        this.finishGoal(goalId, 'stopped', 'turn_error')
      }
    }
  }

  private finishGoal(
    goalId: number,
    status: SessionGoalStatus,
    stopReason: SessionGoalStopReason | null,
    fromStatuses: SessionGoalStatus[] = ['active'],
    patch: SessionGoalPatch = {},
  ): void {
    const record = this.applyTransition(goalId, fromStatuses, {
      ...patch,
      status,
      stopReason,
      finishedAt: status === 'paused' ? null : Date.now(),
    })
    if (record) {
      this.onOutcome(toSessionGoal(record))
    }
  }

  private failAudit(goalId: number, key: string, generation: number): void {
    if (!this.isAuditCurrent(goalId, key, generation)) {
      return
    }
    this.finishGoal(goalId, 'paused', 'audit_failed')
  }

  private async readPrerequisite<T>(
    goalId: number,
    label: string,
    read: () => Promise<T>,
  ): Promise<PrerequisiteResult<T>> {
    for (let attempt = 0; attempt < AUDITOR_ATTEMPTS; attempt += 1) {
      try {
        return { ok: true, value: await read() }
      } catch (error) {
        logger.error(`Session goal ${goalId} ${label} failed (attempt ${attempt + 1}):`, error)
      }
    }
    return { ok: false }
  }

  private isAuditCurrent(
    goalId: number,
    key: string,
    generation: number,
    turnState: SessionGoalTurnState = 'running',
  ): boolean {
    if (this.currentAuditGeneration(key) !== generation) {
      return false
    }
    const record = getSessionGoalById(this.db, goalId)
    return Boolean(record && record.status === 'active' && record.turnState === turnState)
  }

  private currentAuditGeneration(key: string): number {
    return this.auditGeneration.get(key) ?? 0
  }

  private applyTransition(
    goalId: number,
    fromStatuses: SessionGoalStatus[],
    patch: SessionGoalPatch,
  ): SessionGoalRecord | null {
    const record = transitionSessionGoal(this.db, goalId, fromStatuses, patch)
    if (!record) {
      return null
    }

    this.syncGoalIndex(record)
    this.maybeInvalidateAudits(record, patch)
    return record
  }

  private transitionWithOutcome(
    id: number,
    fromStatuses: SessionGoalStatus[],
    patch: SessionGoalPatch,
  ): SessionGoal {
    const goal = toSessionGoal(this.transition(id, fromStatuses, patch))
    this.onOutcome(goal)
    return goal
  }

  private transition(id: number, fromStatuses: SessionGoalStatus[], patch: SessionGoalPatch): SessionGoalRecord {
    const record = this.applyTransition(id, fromStatuses, patch)
    if (!record) {
      if (!getSessionGoalById(this.db, id)) {
        throw new SessionGoalError('Session goal not found', 404)
      }
      throw new SessionGoalError('Session goal cannot transition from its current state', 409)
    }

    return record
  }

  private syncGoalIndex(record: SessionGoalRecord): void {
    const key = goalKey(record.serverId, record.sessionId)
    if (record.status === 'active' || record.status === 'paused') {
      this.goalBySession.set(key, record.id)
    } else {
      this.goalBySession.delete(key)
      this.clearAuditTimer(key)
    }
    if (record.status !== 'active') {
      this.clearRecoveryTimer(key)
    }
  }

  private maybeInvalidateAudits(record: SessionGoalRecord, patch: SessionGoalPatch): void {
    if (patch.status === undefined && patch.turnState !== 'running') {
      return
    }
    const key = goalKey(record.serverId, record.sessionId)
    this.auditGeneration.set(key, this.currentAuditGeneration(key) + 1)
    this.auditRequested.delete(record.id)
  }

  private async readSessionTokenTotal(sessionId: string, serverId: string): Promise<number> {
    const session = await this.servers.getClient(serverId).api.session.get({ sessionID: sessionId })
    return sessionTokenTotal(session.tokens)
  }

  private async readSessionTokenTotalOrDefault(sessionId: string, serverId: string): Promise<number> {
    try {
      return await this.readSessionTokenTotal(sessionId, serverId)
    } catch (error) {
      logger.error(`Failed to read token usage for session ${sessionId}:`, error)
      return 0
    }
  }
}
