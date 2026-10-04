import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { getSessionGoalById, listOpenSessionGoals, transitionSessionGoal } from '../../src/db/session-goals'
import { SessionGoalService, type SessionGoalServiceOptions } from '../../src/services/session-goals'
import { SettingsService } from '../../src/services/settings'
import type { SSEEvent } from '../../src/services/sse-aggregator'
import {
  createFakeSessionGoalClient,
  fakeAssistantMessage,
  type FakeSessionGoalClient,
  type FakeSessionGoalClientOptions,
} from '../helpers/fake-session-goal-client'

const DIRECTORY = '/abs/repo'

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createService(
  db: Database,
  options: FakeSessionGoalClientOptions = {},
  settingsService: SettingsService = new SettingsService(db),
  serviceOptions: SessionGoalServiceOptions = {},
): SessionGoalService {
  return new SessionGoalService(db, createFakeSessionGoalClient(options).client, settingsService, serviceOptions)
}

function executionStarted(sessionID: string): SSEEvent {
  return {
    id: `evt_started_${sessionID}`,
    created: 0,
    type: 'session.execution.started',
    location: { directory: DIRECTORY },
    data: { sessionID },
  } as unknown as SSEEvent
}

function executionSucceeded(sessionID: string): SSEEvent {
  return {
    id: `evt_succeeded_${sessionID}`,
    created: 0,
    type: 'session.execution.succeeded',
    location: { directory: DIRECTORY },
    data: { sessionID },
  } as unknown as SSEEvent
}

function sessionIdle(sessionID: string): SSEEvent {
  return {
    id: `evt_idle_${sessionID}`,
    created: 0,
    type: 'session.idle',
    location: { directory: DIRECTORY },
    data: { sessionID },
  } as unknown as SSEEvent
}

function sessionStatusIdle(sessionID: string): SSEEvent {
  return {
    id: `evt_status_${sessionID}`,
    created: 0,
    type: 'session.status',
    location: { directory: DIRECTORY },
    data: { sessionID, status: { type: 'idle' } },
  } as unknown as SSEEvent
}

function executionFailed(sessionID: string): SSEEvent {
  return {
    id: `evt_failed_${sessionID}`,
    created: 0,
    type: 'session.execution.failed',
    location: { directory: DIRECTORY },
    data: { sessionID, error: { type: 'unknown', message: 'boom' } },
  } as unknown as SSEEvent
}

function executionInterrupted(sessionID: string): SSEEvent {
  return {
    id: `evt_interrupted_${sessionID}`,
    created: 0,
    type: 'session.execution.interrupted',
    location: { directory: DIRECTORY },
    data: { sessionID, reason: 'user' },
  } as unknown as SSEEvent
}

function sessionDeleted(sessionID: string): SSEEvent {
  return {
    id: `evt_deleted_${sessionID}`,
    created: 0,
    type: 'session.deleted',
    location: { directory: DIRECTORY },
    data: { sessionID },
  } as unknown as SSEEvent
}

describe('SessionGoalService', () => {
  let db: Database

  beforeEach(() => {
    vi.useFakeTimers()
    db = createTestDb()
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  it('starts an active goal with the settings defaults and the current token count', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({
      sessionDefaults: {
        permissionMode: 'ask',
        goalMaxContinuations: 7,
        goalTokenBudget: 1234,
        goalAuditorModel: 'provider/model',
      },
    })
    const service = createService(db, { tokens: { ses_1: { input: 100, output: 50, reasoning: 10 } } }, settingsService)

    const goal = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship the feature' })

    expect(goal).toMatchObject({
      sessionId: 'ses_1',
      directory: DIRECTORY,
      objective: 'Ship the feature',
      status: 'active',
      stopReason: null,
      turnState: 'waiting',
      continuationCount: 0,
      maxContinuations: 7,
      tokenBudget: 1234,
      tokensUsed: 0,
      consecutiveBlocked: 0,
      lastVerdict: null,
      lastReason: null,
      finishedAt: null,
    })
    expect(getSessionGoalById(db, goal.id)?.tokensAtStart).toBe(160)
  })

  it('lets explicit input override the settings defaults', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({
      sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 7, goalTokenBudget: 1234 },
    })
    const service = createService(db, {}, settingsService)

    const goal = await service.start({
      sessionId: 'ses_1',
      directory: DIRECTORY,
      objective: 'Ship the feature',
      maxContinuations: 3,
      tokenBudget: 99,
    })

    expect(goal.maxContinuations).toBe(3)
    expect(goal.tokenBudget).toBe(99)
  })

  it('falls back to the default max continuations when settings do not set it', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'ask' } })
    const service = createService(db, {}, settingsService)

    const goal = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    expect(goal.maxContinuations).toBe(20)
    expect(goal.tokenBudget).toBeNull()
  })

  it('uses zero tokens when the session lookup fails', async () => {
    const service = createService(db, { failSessionGet: true })

    const goal = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    expect(getSessionGoalById(db, goal.id)?.tokensAtStart).toBe(0)
  })

  it('rejects a second open goal for the same session with 409', async () => {
    const service = createService(db)

    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'First' })

    await expect(
      service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Second' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(listOpenSessionGoals(db)).toHaveLength(1)
  })

  it('rejects a goal on a scheduled run session with 409 and creates no goal', async () => {
    const service = createService(db, {}, new SettingsService(db), {
      resolveSessionLock: async () => 'schedule',
    })

    await expect(
      service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' }),
    ).rejects.toMatchObject({ status: 409, message: 'Scheduled runs cannot run goals' })
    expect(listOpenSessionGoals(db)).toHaveLength(0)
  })

  it('rejects a goal on a child session with 400 and creates no goal', async () => {
    const service = createService(db, {}, new SettingsService(db), {
      resolveSessionLock: async () => 'child',
    })

    await expect(
      service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' }),
    ).rejects.toMatchObject({ status: 400, message: 'Goals can only be started on top-level sessions' })
    expect(listOpenSessionGoals(db)).toHaveLength(0)
  })

  it('starts a goal when the session is not locked', async () => {
    const service = createService(db, {}, new SettingsService(db), {
      resolveSessionLock: async () => null,
    })

    const goal = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    expect(goal.status).toBe('active')
    expect(listOpenSessionGoals(db)).toHaveLength(1)
  })

  it('starts a goal when the session lock lookup fails', async () => {
    const service = createService(db, {}, new SettingsService(db), {
      resolveSessionLock: async () => {
        throw new Error('lock lookup failed')
      },
    })

    const goal = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    expect(goal.status).toBe('active')
  })

  it('allows a new goal once the previous one is cancelled', async () => {
    const service = createService(db)
    const first = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'First' })

    service.cancel(first.id)
    const second = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Second' })

    expect(second.status).toBe('active')
    expect(listOpenSessionGoals(db)).toHaveLength(1)
  })

  it('pauses and resumes a goal', async () => {
    const service = createService(db)
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    const paused = service.pause(started.id)
    expect(paused.status).toBe('paused')
    expect(paused.stopReason).toBe('user_paused')

    const resumed = service.resume(started.id)
    expect(resumed.status).toBe('active')
    expect(resumed.stopReason).toBeNull()
    expect(resumed.turnState).toBe('running')
  })

  it('cancels a paused goal and rejects cancelling a finished goal', async () => {
    const service = createService(db)
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.pause(started.id)

    const cancelled = service.cancel(started.id)
    expect(cancelled.status).toBe('stopped')
    expect(cancelled.stopReason).toBe('cancelled')
    expect(cancelled.finishedAt).not.toBeNull()

    expect(() => service.cancel(started.id)).toThrowError(
      expect.objectContaining({ status: 409 }) as Error,
    )
  })

  it('rejects pausing a missing goal with 404', async () => {
    const service = createService(db)

    expect(() => service.pause(999)).toThrowError(expect.objectContaining({ status: 404 }) as Error)
  })

  it('emits exactly one outcome when pausing an active goal', async () => {
    const outcomes: string[] = []
    const service = createService(db, {}, new SettingsService(db), {
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    const paused = service.pause(started.id)

    expect(paused.status).toBe('paused')
    expect(outcomes).toEqual(['paused'])
  })

  it('emits exactly one outcome when cancelling an active goal', async () => {
    const outcomes: string[] = []
    const service = createService(db, {}, new SettingsService(db), {
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    const cancelled = service.cancel(started.id)

    expect(cancelled.status).toBe('stopped')
    expect(outcomes).toEqual(['stopped'])
  })

  it('emits exactly one outcome when cancelling a paused goal', async () => {
    const outcomes: string[] = []
    const service = createService(db, {}, new SettingsService(db), {
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.pause(started.id)
    outcomes.length = 0

    service.cancel(started.id)

    expect(outcomes).toEqual(['stopped'])
  })

  it('does not emit an outcome when a pause transition is rejected', async () => {
    const outcomes: string[] = []
    const service = createService(db, {}, new SettingsService(db), {
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.pause(started.id)
    outcomes.length = 0

    expect(() => service.pause(started.id)).toThrowError(expect.objectContaining({ status: 409 }) as Error)

    expect(outcomes).toEqual([])
  })

  it('does not emit an outcome when a cancel transition is rejected', async () => {
    const outcomes: string[] = []
    const service = createService(db, {}, new SettingsService(db), {
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.cancel(started.id)
    outcomes.length = 0

    expect(() => service.cancel(started.id)).toThrowError(expect.objectContaining({ status: 409 }) as Error)

    expect(outcomes).toEqual([])
  })

  it('does not emit an outcome when resuming a paused goal', async () => {
    const outcomes: string[] = []
    const service = createService(db, {}, new SettingsService(db), {
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.pause(started.id)
    outcomes.length = 0

    service.resume(started.id)
    await vi.runAllTimersAsync()

    expect(outcomes).toEqual([])
  })

  it('returns the latest goal for a session', async () => {
    const service = createService(db)

    expect(service.getLatest('ses_1')).toBeNull()

    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    expect(service.getLatest('ses_1')?.id).toBe(started.id)
  })

  it('loads open goals so events are handled after a restart', async () => {
    const started = await createService(db).start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    const fake = createFakeSessionGoalClient()
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    restarted.loadOpenGoals()
    await restarted.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await restarted.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(1)
    expect(getSessionGoalById(db, started.id)?.turnState).toBe('waiting')
  })
})

describe('SessionGoalService audit loop', () => {
  let db: Database
  let fake: FakeSessionGoalClient
  let service: SessionGoalService

  beforeEach(() => {
    vi.useFakeTimers()
    db = createTestDb()
    fake = createFakeSessionGoalClient()
    service = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  async function runTurn(sessionId: string): Promise<void> {
    await service.handleEvent(DIRECTORY, executionStarted(sessionId))
    await service.handleEvent(DIRECTORY, sessionIdle(sessionId))
    await vi.runAllTimersAsync()
  }

  it('completes the goal when the auditor says done', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('The feature is shipped and tested.')])
    fake.setAuditorReplies(['{"verdict":"done","reason":"Objective achieved."}'])
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('completed')
    expect(latest?.stopReason).toBeNull()
    expect(latest?.lastVerdict).toBe('done')
    expect(latest?.lastReason).toBe('Objective achieved.')
    expect(latest?.finishedAt).not.toBeNull()
    expect(fake.promptCalls).toHaveLength(0)
    expect(fake.auditorCalls[0]?.prompt).toContain('Ship it')
    expect(fake.auditorCalls[0]?.prompt).toContain('The feature is shipped and tested.')
    expect(getSessionGoalById(db, started.id)?.turnState).toBe('running')
  })

  it('sends one continuation prompt and increments the count on continue', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Working on the route.')])
    fake.setAuditorReplies(['{"verdict":"continue","reason":"Tests still fail."}'])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('active')
    expect(latest?.turnState).toBe('waiting')
    expect(latest?.continuationCount).toBe(1)
    expect(fake.promptCalls).toHaveLength(1)
    expect(fake.promptCalls[0]?.sessionID).toBe('ses_1')
    expect(fake.promptCalls[0]?.text).toContain('Ship it')
    expect(fake.promptCalls[0]?.text).toContain('Tests still fail.')
  })

  it('stops the goal at the continuation cap', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Still working.')])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it', maxContinuations: 1 })

    await runTurn('ses_1')
    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('continuation_limit')
    expect(latest?.continuationCount).toBe(1)
    expect(fake.promptCalls).toHaveLength(1)
  })

  it('continues twice and blocks on the third blocked verdict', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('I need a decision.')])
    fake.setAuditorReplies([
      '{"verdict":"blocked","reason":"Needs a decision."}',
      '{"verdict":"blocked","reason":"Needs a decision."}',
      '{"verdict":"blocked","reason":"Needs a decision."}',
    ])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await runTurn('ses_1')
    expect(service.getLatest('ses_1')?.status).toBe('active')
    expect(service.getLatest('ses_1')?.consecutiveBlocked).toBe(1)

    await runTurn('ses_1')
    expect(service.getLatest('ses_1')?.status).toBe('active')
    expect(service.getLatest('ses_1')?.consecutiveBlocked).toBe(2)

    await runTurn('ses_1')
    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('blocked')
    expect(latest?.consecutiveBlocked).toBe(3)
    expect(fake.promptCalls).toHaveLength(2)
  })

  it('resets the blocked counter on a continue verdict', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Back to work.')])
    fake.setAuditorReplies([
      '{"verdict":"blocked","reason":"Needs a decision."}',
      '{"verdict":"continue","reason":"Unblocked."}',
      '{"verdict":"blocked","reason":"Needs a decision."}',
    ])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await runTurn('ses_1')
    await runTurn('ses_1')
    expect(service.getLatest('ses_1')?.consecutiveBlocked).toBe(0)

    await runTurn('ses_1')
    expect(service.getLatest('ses_1')?.consecutiveBlocked).toBe(1)
  })

  it('stops on a token budget overrun before calling the auditor', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Still working.')])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it', tokenBudget: 100 })
    fake.setTokens('ses_1', { input: 250, output: 0, reasoning: 0 })

    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('token_budget')
    expect(latest?.tokensUsed).toBe(250)
    expect(fake.auditorCalls).toHaveLength(0)
  })

  it('stops with turn_error when the execution fails', async () => {
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionFailed('ses_1'))

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('turn_error')
    expect(fake.auditorCalls).toHaveLength(0)
  })

  it('stops with turn_error when the latest reply carries an error', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Partial output', { error: 'provider crashed' })])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('turn_error')
    expect(fake.auditorCalls).toHaveLength(0)
  })

  it('pauses with audit_failed after two auditor failures', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Still working.')])
    fake.failNextAuditorCalls(2)
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('paused')
    expect(latest?.stopReason).toBe('audit_failed')
    expect(latest?.finishedAt).toBeNull()
    expect(fake.auditorCalls).toHaveLength(2)
  })

  it('treats an unparseable verdict as continue', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Still working.')])
    fake.setAuditorReplies(['I am not sure.'])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('active')
    expect(latest?.lastVerdict).toBe('continue')
    expect(latest?.lastReason).toBe('Auditor response was not understood')
    expect(fake.promptCalls).toHaveLength(1)
  })

  it('does not audit an idle event while the turn is waiting', async () => {
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(0)
  })

  it('audits on execution.succeeded and on a session.status idle event', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Done.')])
    fake.setAuditorReplies(['{"verdict":"continue","reason":"keep going"}', '{"verdict":"done","reason":"finished"}'])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await service.handleEvent(DIRECTORY, executionSucceeded('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.auditorCalls).toHaveLength(1)

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await service.handleEvent(DIRECTORY, sessionStatusIdle('ses_1'))
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(2)
    expect(service.getLatest('ses_1')?.status).toBe('completed')
  })

  it('ignores events for a session without an open goal', async () => {
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionStarted('ses_other'))
    await service.handleEvent(DIRECTORY, executionFailed('ses_other'))
    await vi.runAllTimersAsync()

    expect(service.getLatest('ses_1')?.status).toBe('active')
    expect(fake.auditorCalls).toHaveLength(0)
  })

  it('schedules an audit immediately when a paused goal resumes', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Back.')])
    fake.setAuditorReplies(['{"verdict":"done","reason":"finished"}'])
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.pause(started.id)

    service.resume(started.id)
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(1)
    expect(service.getLatest('ses_1')?.status).toBe('completed')
  })

  it('does not schedule an audit on resume while the session is busy', async () => {
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.pause(started.id)
    fake.setBusy('ses_1', true)

    service.resume(started.id)
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(0)
    expect(service.getLatest('ses_1')?.status).toBe('active')
  })

  it('pauses with interrupted when the execution is interrupted', async () => {
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionInterrupted('ses_1'))

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('paused')
    expect(latest?.stopReason).toBe('interrupted')
    expect(latest?.finishedAt).toBeNull()
  })

  it('stops with session_deleted when the session is deleted', async () => {
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    service.pause(started.id)

    await service.handleEvent(DIRECTORY, sessionDeleted('ses_1'))

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('session_deleted')
  })

  it('stops with turn_error when the continuation prompt fails', async () => {
    const failing = createFakeSessionGoalClient({ failSessionPrompt: true })
    const failingService = new SessionGoalService(db, failing.client, new SettingsService(db), { quietMs: 0 })
    failing.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    failing.setAuditorReplies(['{"verdict":"continue","reason":"keep going"}'])
    await failingService.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await failingService.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await failingService.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()

    const latest = failingService.getLatest('ses_1')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('turn_error')
  })

  it('discards a late continuation failure after a new execution starts', async () => {
    const outcomes: string[] = []
    const tracked = new SessionGoalService(db, fake.client, new SettingsService(db), {
      quietMs: 0,
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    fake.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    fake.setAuditorReplies(['{"verdict":"continue","reason":"keep going"}'])
    fake.deferNextSessionPrompts(1)
    await tracked.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await tracked.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await tracked.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.pendingSessionPromptCalls).toHaveLength(1)
    expect(tracked.getLatest('ses_1')?.turnState).toBe('waiting')

    await tracked.handleEvent(DIRECTORY, executionStarted('ses_1'))
    fake.pendingSessionPromptCalls[0]?.reject(new Error('transport dropped'))
    await vi.runAllTimersAsync()

    const latest = tracked.getLatest('ses_1')
    expect(latest?.status).toBe('active')
    expect(latest?.turnState).toBe('running')
    expect(latest?.stopReason).toBeNull()
    expect(outcomes).toEqual([])
  })

  it('discards a late continuation failure across pause and resume', async () => {
    const outcomes: string[] = []
    const tracked = new SessionGoalService(db, fake.client, new SettingsService(db), {
      quietMs: 0,
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    fake.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    fake.setAuditorReplies(['{"verdict":"continue","reason":"keep going"}'])
    fake.deferNextSessionPrompts(1)
    const started = await tracked.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await tracked.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await tracked.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.pendingSessionPromptCalls).toHaveLength(1)

    tracked.pause(started.id)
    tracked.resume(started.id)
    await vi.runAllTimersAsync()
    expect(outcomes).toEqual(['paused'])
    outcomes.length = 0

    fake.pendingSessionPromptCalls[0]?.reject(new Error('transport dropped'))
    await vi.runAllTimersAsync()

    const latest = tracked.getLatest('ses_1')
    expect(latest?.status).toBe('active')
    expect(latest?.stopReason).toBeNull()
    expect(outcomes).toEqual([])
  })

  it('passes the configured auditor model to the auditor call', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'ask', goalAuditorModel: 'anthropic/claude-x' } })
    const configured = new SessionGoalService(db, fake.client, settingsService, { quietMs: 0 })
    fake.setMessages('ses_1', [fakeAssistantMessage('Done.')])
    fake.setAuditorReplies(['{"verdict":"done","reason":"finished"}'])
    await configured.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await configured.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await configured.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls[0]?.model).toEqual({ providerID: 'anthropic', id: 'claude-x' })
  })

  it('calls onOutcome for terminal transitions', async () => {
    const outcomes: string[] = []
    const tracked = new SessionGoalService(db, fake.client, new SettingsService(db), {
      quietMs: 0,
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    fake.setMessages('ses_1', [fakeAssistantMessage('Done.')])
    fake.setAuditorReplies(['{"verdict":"done","reason":"finished"}'])
    await tracked.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await tracked.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await tracked.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()

    expect(outcomes).toEqual(['completed'])
  })

  it('pauses with audit_failed when the busy check fails', async () => {
    const outcomes: string[] = []
    const tracked = new SessionGoalService(db, fake.client, new SettingsService(db), {
      quietMs: 0,
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    fake.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    await tracked.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    fake.setFailSessionActive(true)

    await tracked.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await tracked.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()

    const latest = tracked.getLatest('ses_1')
    expect(latest?.status).toBe('paused')
    expect(latest?.stopReason).toBe('audit_failed')
    expect(fake.auditorCalls).toHaveLength(0)
    expect(fake.promptCalls).toHaveLength(0)
    expect(outcomes).toEqual(['paused'])
  })

  it('pauses with audit_failed when the token lookup fails without resetting usage', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    fake.setTokens('ses_1', { input: 50, output: 0, reasoning: 0 })
    fake.setAuditorReplies(['{"verdict":"continue","reason":"keep going"}'])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it', tokenBudget: 100 })

    fake.setTokens('ses_1', { input: 100, output: 0, reasoning: 0 })
    await runTurn('ses_1')
    expect(service.getLatest('ses_1')?.tokensUsed).toBe(50)

    fake.setTokens('ses_1', { input: 250, output: 0, reasoning: 0 })
    fake.setFailSessionGet(true)
    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('paused')
    expect(latest?.stopReason).toBe('audit_failed')
    expect(latest?.tokensUsed).toBe(50)
    expect(fake.promptCalls).toHaveLength(1)
    expect(fake.auditorCalls).toHaveLength(1)
  })

  it('pauses with audit_failed when the reply lookup fails', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    fake.setFailMessageList(true)

    await runTurn('ses_1')

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('paused')
    expect(latest?.stopReason).toBe('audit_failed')
    expect(fake.auditorCalls).toHaveLength(0)
    expect(fake.promptCalls).toHaveLength(0)
  })

  it('pauses with audit_failed when the resume busy check fails', async () => {
    const outcomes: string[] = []
    const tracked = new SessionGoalService(db, fake.client, new SettingsService(db), {
      quietMs: 0,
      onOutcome: (goal) => outcomes.push(goal.status),
    })
    const started = await tracked.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })
    tracked.pause(started.id)
    outcomes.length = 0
    fake.setFailSessionActive(true)

    tracked.resume(started.id)
    await vi.runAllTimersAsync()

    const latest = tracked.getLatest('ses_1')
    expect(latest?.status).toBe('paused')
    expect(latest?.stopReason).toBe('audit_failed')
    expect(fake.auditorCalls).toHaveLength(0)
    expect(outcomes).toEqual(['paused'])
  })

  it('discards a stale continue verdict when a new execution starts mid-audit', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    fake.deferNextAuditorCalls(1)
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await service.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.pendingAuditorCalls).toHaveLength(1)

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    fake.setBusy('ses_1', true)
    fake.pendingAuditorCalls[0]?.resolve('{"verdict":"continue","reason":"keep going"}')
    await vi.runAllTimersAsync()

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('active')
    expect(latest?.continuationCount).toBe(0)
    expect(latest?.turnState).toBe('running')
    expect(fake.promptCalls).toHaveLength(0)
  })

  it('discards a stale done verdict when the goal is paused mid-audit', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Done.')])
    fake.deferNextAuditorCalls(1)
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await service.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.pendingAuditorCalls).toHaveLength(1)

    service.pause(started.id)
    fake.pendingAuditorCalls[0]?.resolve('{"verdict":"done","reason":"finished"}')
    await vi.runAllTimersAsync()

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('paused')
    expect(latest?.stopReason).toBe('user_paused')
    expect(latest?.lastVerdict).toBeNull()
  })

  it('retains a newer idle audit while an older audit is in flight', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Turn 1.')])
    fake.setAuditorReplies(['{"verdict":"continue","reason":"second"}'])
    fake.deferNextAuditorCalls(1)
    await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await service.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.pendingAuditorCalls).toHaveLength(1)

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    fake.setMessages('ses_1', [fakeAssistantMessage('Turn 2.')])
    await service.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.pendingAuditorCalls).toHaveLength(1)

    fake.pendingAuditorCalls[0]?.resolve('{"verdict":"continue","reason":"stale"}')
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(2)
    expect(fake.maxConcurrentAuditorCalls).toBe(1)
    expect(fake.promptCalls).toHaveLength(1)
    expect(fake.promptCalls[0]?.text).toContain('second')
    const latest = service.getLatest('ses_1')
    expect(latest?.continuationCount).toBe(1)
    expect(latest?.turnState).toBe('waiting')
  })

  it('discards an in-flight audit result across pause and resume', async () => {
    fake.setMessages('ses_1', [fakeAssistantMessage('Working.')])
    fake.setAuditorReplies(['{"verdict":"continue","reason":"fresh"}'])
    fake.deferNextAuditorCalls(1)
    const started = await service.start({ sessionId: 'ses_1', directory: DIRECTORY, objective: 'Ship it' })

    await service.handleEvent(DIRECTORY, executionStarted('ses_1'))
    await service.handleEvent(DIRECTORY, sessionIdle('ses_1'))
    await vi.runAllTimersAsync()
    expect(fake.pendingAuditorCalls).toHaveLength(1)

    service.pause(started.id)
    service.resume(started.id)
    await vi.runAllTimersAsync()

    fake.pendingAuditorCalls[0]?.resolve('{"verdict":"done","reason":"stale"}')
    await vi.runAllTimersAsync()

    const latest = service.getLatest('ses_1')
    expect(latest?.status).toBe('active')
    expect(latest?.lastVerdict).toBe('continue')
    expect(fake.auditorCalls).toHaveLength(2)
    expect(fake.promptCalls).toHaveLength(1)
  })
})

describe('SessionGoalService recovery', () => {
  let db: Database

  beforeEach(() => {
    vi.useFakeTimers()
    db = createTestDb()
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  it('resumes auditing a running goal on recovery and leaves a waiting goal alone', async () => {
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    const waiting = await createService(db).start({ sessionId: 'ses_wait', directory: DIRECTORY, objective: 'Later' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient()
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    await restarted.recoverOpenGoals()
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(1)
    expect(fake.auditorCalls[0]?.prompt).toContain('Ship it')
    expect(getSessionGoalById(db, waiting.id)?.turnState).toBe('waiting')
    expect(fake.auditorCalls[0]?.prompt).not.toContain('Later')
  })

  it('leaves a running goal alone while the session is busy', async () => {
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient()
    fake.setBusy('ses_run', true)
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    await restarted.recoverOpenGoals()
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(0)
    expect(getSessionGoalById(db, running.id)?.status).toBe('active')
  })

  it('stops a running goal when its session no longer exists', async () => {
    const outcomes: string[] = []
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient()
    fake.setSessionMissing('ses_run', true)
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), {
      quietMs: 0,
      onOutcome: (goal) => outcomes.push(goal.status),
    })

    await restarted.recoverOpenGoals()
    await vi.runAllTimersAsync()

    const latest = restarted.getLatest('ses_run')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('session_deleted')
    expect(fake.auditorCalls).toHaveLength(0)
    expect(outcomes).toEqual(['stopped'])
  })

  it('retries recovery after a transient session lookup failure without session events', async () => {
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient({ failSessionGet: true })
    fake.setAuditorReplies(['{"verdict":"done","reason":"finished"}'])
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    await restarted.recoverOpenGoals()
    expect(fake.auditorCalls).toHaveLength(0)
    expect(restarted.getLatest('ses_run')?.status).toBe('active')

    fake.setFailSessionGet(false)
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(1)
    expect(restarted.getLatest('ses_run')?.status).toBe('completed')
  })

  it('retries recovery after a transient busy-check failure without session events', async () => {
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient()
    fake.setAuditorReplies(['{"verdict":"done","reason":"finished"}'])
    fake.setFailSessionActive(true)
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    await restarted.recoverOpenGoals()
    expect(fake.auditorCalls).toHaveLength(0)

    fake.setFailSessionActive(false)
    await vi.runAllTimersAsync()

    expect(fake.auditorCalls).toHaveLength(1)
    expect(restarted.getLatest('ses_run')?.status).toBe('completed')
  })

  it('stops with session_deleted when the session disappears before the recovery retry', async () => {
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient({ failSessionGet: true })
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    await restarted.recoverOpenGoals()
    fake.setFailSessionGet(false)
    fake.setSessionMissing('ses_run', true)
    await vi.runAllTimersAsync()

    const latest = restarted.getLatest('ses_run')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('session_deleted')
    expect(fake.auditorCalls).toHaveLength(0)
  })

  it('does not audit a goal paused during the recovery retry delay', async () => {
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient({ failSessionGet: true })
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    await restarted.recoverOpenGoals()
    restarted.pause(running.id)

    fake.setFailSessionGet(false)
    await vi.runAllTimersAsync()

    expect(restarted.getLatest('ses_run')?.status).toBe('paused')
    expect(fake.auditorCalls).toHaveLength(0)
  })

  it('does not audit a goal cancelled during the recovery retry delay', async () => {
    const running = await createService(db).start({ sessionId: 'ses_run', directory: DIRECTORY, objective: 'Ship it' })
    transitionSessionGoal(db, running.id, ['active'], { turnState: 'running' })

    const fake = createFakeSessionGoalClient({ failSessionGet: true })
    const restarted = new SessionGoalService(db, fake.client, new SettingsService(db), { quietMs: 0 })

    await restarted.recoverOpenGoals()
    restarted.cancel(running.id)

    fake.setFailSessionGet(false)
    await vi.runAllTimersAsync()

    const latest = restarted.getLatest('ses_run')
    expect(latest?.status).toBe('stopped')
    expect(latest?.stopReason).toBe('cancelled')
    expect(fake.auditorCalls).toHaveLength(0)
  })
})
