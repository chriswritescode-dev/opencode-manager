import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { createScheduleRun, updateScheduleRunMetadata } from '../../src/db/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { sseAggregator, type SSEEvent } from '../../src/services/sse-aggregator'
import type { PushNotificationPayload } from '@opencode-manager/shared/types'
import type { SessionGoal } from '@opencode-manager/shared/schemas'

const DIRECTORY = '/abs/repo'
const USER_ID = 'user-1'

const sendResult = { delivered: 0, expired: 0, failed: 0, total: 0 }

function formCreatedEvent(sessionID: string): SSEEvent {
  return {
    id: 'evt_form_1',
    created: 1700000000000,
    type: 'form.created',
    location: { directory: DIRECTORY },
    data: {
      form: {
        id: 'form-1',
        sessionID,
        title: 'Deploy to prod?',
        fields: [{ key: 'confirm', type: 'string' }],
      },
    },
  }
}

function permissionAskedEvent(sessionID: string): SSEEvent {
  return {
    id: 'evt_perm_1',
    created: 1700000000000,
    type: 'permission.asked',
    location: { directory: DIRECTORY },
    data: {
      id: 'perm-1',
      sessionID,
      action: 'shell',
      resources: ['ls -la'],
    },
  }
}

function createService(db = new Database(':memory:')): NotificationService {
  migrate(db, allMigrations)
  createRepo(db, {
    localPath: 'repo-one',
    sourcePath: DIRECTORY,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  })

  const service = new NotificationService(db)
  vi.spyOn(service, 'isConfigured').mockReturnValue(true)
  service.saveSubscription(USER_ID, 'https://push.example.com/sub-1', 'p256dh-key', 'auth-key')
  new SettingsService(db).updateSettings(
    {
      notifications: {
        enabled: true,
        events: { permissionAsked: true, questionAsked: true, sessionError: true, sessionIdle: true },
      },
    },
    USER_ID,
  )
  return service
}

describe('NotificationService.handleSSEEvent session routing', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('routes a real V2 form.created event to the session carried in data.form', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, formCreatedEvent('ses_form'))

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Question')
    expect(payload.tag).toBe('form.created-ses_form')
    expect(payload.data?.sessionId).toBe('ses_form')
    expect(payload.data?.url).toBe('/repos/1/sessions/ses_form')
  })

  it('suppresses a form.created event for a session the user is viewing', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSessionBeingViewed').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, formCreatedEvent('ses_form'))

    expect(send).not.toHaveBeenCalled()
  })

  it('suppresses a form.created event for a subagent session', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSubagentSession').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, formCreatedEvent('ses_form'))

    expect(send).not.toHaveBeenCalled()
  })

  it('keeps permission notifications session-scoped from the top-level sessionID', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_perm'))

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.tag).toBe('permission.asked-ses_perm')
    expect(payload.data?.sessionId).toBe('ses_perm')
    expect(payload.data?.url).toBe('/repos/1/sessions/ses_perm')
  })

  it('opens the run report for a scheduled session that finishes, but the session for its permission prompts', async () => {
    const db = new Database(':memory:')
    const service = createService(db)
    db.exec('PRAGMA foreign_keys = OFF')
    const run = createScheduleRun(db, { jobId: 5, repoId: 1, triggerSource: 'schedule', status: 'running', startedAt: 1, createdAt: 1 })
    updateScheduleRunMetadata(db, 1, 5, run.id, { sessionId: 'ses_sched' })
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, {
      id: 'evt_idle_1',
      created: 1700000000000,
      type: 'session.idle',
      location: { directory: DIRECTORY },
      data: { sessionID: 'ses_sched' },
    } as SSEEvent)
    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_sched'))

    const urls = send.mock.calls.map((call) => (call[1] as PushNotificationPayload).data?.url)
    expect(urls).toEqual([`/schedules?scheduleTab=runs&runId=${run.id}`, '/repos/1/sessions/ses_sched'])
  })

  it('suppresses a permission for a session the user is viewing', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSessionBeingViewed').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_perm'))

    expect(send).not.toHaveBeenCalled()
  })

  it('suppresses an event when a registered suppressor resolves true', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    const suppressor = vi.fn(async () => true)
    service.addEventSuppressor(suppressor)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_perm'))

    expect(suppressor).toHaveBeenCalledWith(expect.objectContaining({ type: 'permission.asked' }), 'ses_perm')
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps notifying when every registered suppressor resolves false', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    service.addEventSuppressor(async () => false)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_perm'))

    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('NotificationService goal outcomes', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const completedGoal: SessionGoal = {
    id: 1,
    sessionId: 'ses_goal',
    directory: DIRECTORY,
    objective: 'Ship the feature',
    status: 'completed',
    stopReason: null,
    turnState: 'running',
    continuationCount: 1,
    maxContinuations: 5,
    tokenBudget: null,
    tokensUsed: 0,
    consecutiveBlocked: 0,
    lastVerdict: 'done',
    lastReason: 'Objective achieved',
    createdAt: 1,
    updatedAt: 2,
    finishedAt: 3,
  }

  it('notifies a goal outcome when the preference is unset', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome(completedGoal)

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Goal completed')
    expect(payload.body).toContain('Ship the feature')
    expect(payload.body).toContain('Objective achieved')
    expect(payload.tag).toBe('session-goal-1')
    expect(payload.data?.eventType).toBe('session.goal.outcome')
    expect(payload.data?.sessionId).toBe('ses_goal')
    expect(payload.data?.url).toBe('/repos/1/sessions/ses_goal')
  })

  it('reports the stop reason instead of a stale verdict reason', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...completedGoal,
      id: 2,
      status: 'stopped',
      stopReason: 'token_budget',
      lastVerdict: 'continue',
      lastReason: 'Keep working on the tests',
    })

    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Goal stopped')
    expect(payload.body).toContain('Token budget reached')
    expect(payload.body).not.toContain('Keep working on the tests')
  })

  it('states the pause cause when a paused goal has no verdict reason', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...completedGoal,
      id: 3,
      status: 'paused',
      stopReason: 'audit_failed',
      lastVerdict: null,
      lastReason: null,
    })

    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Goal paused')
    expect(payload.body).toContain('Audit failed')
  })

  it('keeps the reason visible for a long objective within the body limit', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...completedGoal,
      id: 4,
      objective: 'Ship the entire feature '.repeat(20),
      status: 'stopped',
      stopReason: 'continuation_limit',
    })

    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.body.length).toBeLessThanOrEqual(140)
    expect(payload.body).toContain('Continuation limit reached')
    expect(payload.body).toContain('…')
  })

  it('respects a disabled goalOutcome preference', async () => {
    const db = new Database(':memory:')
    const service = createService(db)
    new SettingsService(db).updateSettings(
      {
        notifications: {
          enabled: true,
          events: { permissionAsked: true, questionAsked: true, sessionError: true, sessionIdle: true, goalOutcome: false },
        },
      },
      USER_ID,
    )
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome(completedGoal)

    expect(send).not.toHaveBeenCalled()
  })

  it('does not notify when the goal stopped because its turn failed', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...completedGoal,
      id: 11,
      status: 'stopped',
      stopReason: 'turn_error',
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not notify when the user cancelled the goal', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...completedGoal,
      id: 12,
      status: 'stopped',
      stopReason: 'cancelled',
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not notify when the user paused the goal', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...completedGoal,
      id: 13,
      status: 'paused',
      stopReason: 'user_paused',
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not notify while the goal session is being viewed', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSessionBeingViewed').mockReturnValue(true)

    await service.notifyGoalOutcome(completedGoal)

    expect(send).not.toHaveBeenCalled()
  })

  it('notifies the remaining goal outcomes', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    const outcomes: Array<Pick<SessionGoal, 'status' | 'stopReason'>> = [
      { status: 'blocked', stopReason: null },
      { status: 'stopped', stopReason: 'continuation_limit' },
      { status: 'stopped', stopReason: 'token_budget' },
      { status: 'stopped', stopReason: 'interrupted' },
      { status: 'paused', stopReason: 'audit_failed' },
      { status: 'stopped', stopReason: 'session_deleted' },
    ]

    for (const [index, outcome] of outcomes.entries()) {
      await service.notifyGoalOutcome({ ...completedGoal, id: 100 + index, ...outcome })
    }

    expect(send).toHaveBeenCalledTimes(outcomes.length)
  })
})
