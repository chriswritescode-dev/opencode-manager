import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { createScheduleJob, createScheduleRun, updateScheduleRunMetadata } from '../../src/db/schedules'
import { buildCreateSchedulePersistenceInput } from '../../src/services/schedule-config'
import { NotificationService, type NotificationServerRegistry } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { sseAggregator, type SSEEvent } from '../../src/services/sse-aggregator'
import type { PushNotificationPayload } from '@opencode-manager/shared/types'
import type { GoalState } from '@opencode-manager/shared/opencode'
import type { SessionGoalOutcome } from '../../src/services/goal-outcomes'
import { CreateScheduleJobRequestSchema, type ScheduleJob } from '@opencode-manager/shared/schemas'

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

function createService(
  db = new Database(':memory:'),
  registry: NotificationServerRegistry | null = null,
): NotificationService {
  migrate(db, allMigrations)
  createRepo(db, {
    localPath: 'repo-one',
    sourcePath: DIRECTORY,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  })

  const service = new NotificationService(db, registry)
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

function createScheduledJob(db: Database, showInInbox: boolean, serverId?: string): ScheduleJob {
  const request = CreateScheduleJobRequestSchema.parse({
    name: 'Nightly audit',
    scheduleMode: 'interval',
    intervalMinutes: 60,
    prompt: 'Summarize the repository.',
    showInInbox,
  })
  return createScheduleJob(db, 1, buildCreateSchedulePersistenceInput(request), serverId)
}

function linkRunSession(db: Database, job: ScheduleJob, sessionId: string, serverId?: string) {
  const now = Date.now()
  const run = createScheduleRun(db, {
    jobId: job.id,
    repoId: job.repoId,
    serverId,
    triggerSource: 'schedule',
    status: 'running',
    startedAt: now,
    createdAt: now,
  })
  updateScheduleRunMetadata(db, job.repoId, job.id, run.id, { sessionId })
  return run
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

    expect(suppressor).toHaveBeenCalledWith(expect.objectContaining({ type: 'permission.asked' }), 'ses_perm', 'local')
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

describe('NotificationService quiet schedule announcements', () => {
  const REMOTE_SERVER_ID = 'srv_kitchen'

  function idleEvent(sessionID: string): SSEEvent {
    return {
      id: 'evt_idle_quiet_1',
      created: 1700000000000,
      type: 'session.idle',
      location: { directory: DIRECTORY },
      data: { sessionID },
    } as SSEEvent
  }

  function failedEvent(sessionID: string): SSEEvent {
    return {
      id: 'evt_failed_quiet_1',
      created: 1700000000000,
      type: 'session.execution.failed',
      location: { directory: DIRECTORY },
      data: { sessionID, error: { type: 'provider', message: 'boom' } },
    } as SSEEvent
  }

  function remoteRegistry(): NotificationServerRegistry {
    return {
      get: (serverId) => (serverId === REMOTE_SERVER_ID ? { name: 'Kitchen', enabled: true } : null),
    }
  }

  beforeEach(() => {
    sseAggregator.shutdown()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips the completion push for a quiet schedule run', async () => {
    const db = new Database(':memory:')
    const service = createService(db)
    const job = createScheduledJob(db, false)
    linkRunSession(db, job, 'ses_quiet')
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, idleEvent('ses_quiet'))

    expect(send).not.toHaveBeenCalled()
  })

  it('still pushes a failure for a quiet schedule run', async () => {
    const db = new Database(':memory:')
    const service = createService(db)
    const job = createScheduledJob(db, false)
    linkRunSession(db, job, 'ses_quiet')
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, failedEvent('ses_quiet'))

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Error')
    expect(payload.tag).toBe('session.execution.failed-ses_quiet')
  })

  it('pushes the run report for an announcing schedule run', async () => {
    const db = new Database(':memory:')
    const service = createService(db)
    const job = createScheduledJob(db, true)
    const run = linkRunSession(db, job, 'ses_loud')
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, idleEvent('ses_loud'))

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Session complete')
    expect(payload.data?.url).toBe(`/schedules?scheduleTab=runs&runId=${run.id}`)
  })

  it('skips the completion push for a quiet remote schedule run', async () => {
    const db = new Database(':memory:')
    const service = createService(db, remoteRegistry())
    const job = createScheduledJob(db, false, REMOTE_SERVER_ID)
    linkRunSession(db, job, 'ses_remote_quiet', REMOTE_SERVER_ID)
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, idleEvent('ses_remote_quiet'), REMOTE_SERVER_ID)

    expect(send).not.toHaveBeenCalled()
  })

  it('pushes the completion of an announcing remote schedule run', async () => {
    const db = new Database(':memory:')
    const service = createService(db, remoteRegistry())
    const job = createScheduledJob(db, true, REMOTE_SERVER_ID)
    linkRunSession(db, job, 'ses_remote_loud', REMOTE_SERVER_ID)
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, idleEvent('ses_remote_loud'), REMOTE_SERVER_ID)

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.data?.serverId).toBe(REMOTE_SERVER_ID)
  })

  it('still pushes a permission prompt for a quiet schedule run', async () => {
    const db = new Database(':memory:')
    const service = createService(db)
    const job = createScheduledJob(db, false)
    linkRunSession(db, job, 'ses_quiet')
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_quiet'))

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.data?.url).toBe('/repos/1/sessions/ses_quiet')
  })
})

describe('NotificationService goal outcomes', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const completedGoal: GoalState = {
    id: 'goal_1',
    objective: 'Ship the feature',
    status: 'complete',
    reason: 'Objective achieved',
    rounds: 1,
    maxRounds: 5,
    boot: 'boot-1',
    updatedAt: 3,
  }

  const goalOutcome: SessionGoalOutcome = {
    serverId: 'local',
    sessionId: 'ses_goal',
    directory: DIRECTORY,
    goal: completedGoal,
  }

  it('notifies a goal outcome when the preference is unset', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome(goalOutcome)

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Goal completed')
    expect(payload.body).toContain('Ship the feature')
    expect(payload.body).toContain('Objective achieved')
    expect(payload.tag).toBe('session-goal-goal_1')
    expect(payload.data?.eventType).toBe('session.goal.outcome')
    expect(payload.data?.sessionId).toBe('ses_goal')
    expect(payload.data?.url).toBe('/repos/1/sessions/ses_goal')
  })

  it('notifies a remote goal outcome with its server in the payload', async () => {
    const service = createService(new Database(':memory:'), {
      get: (serverId) => (serverId === 'srv_kitchen' ? { name: 'Kitchen', enabled: true } : null),
    })
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      serverId: 'srv_kitchen',
      sessionId: 'ses_remote',
      directory: '/home/me/app',
      goal: completedGoal,
    })

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.body).toContain('Kitchen')
    expect(payload.data?.serverId).toBe('srv_kitchen')
    expect(payload.data?.serverName).toBe('Kitchen')
    expect(payload.data?.url).toBe('/servers/srv_kitchen/sessions/ses_remote')
  })

  it('titles a paused goal from its reason', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...goalOutcome,
      goal: {
        ...completedGoal,
        status: 'paused',
        reason: 'The server restarted while the goal was active',
      },
    })

    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Goal paused')
    expect(payload.body).toContain('The server restarted while the goal was active')
  })

  it('keeps the reason visible for a long objective within the body limit', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...goalOutcome,
      goal: {
        ...completedGoal,
        objective: 'Ship the entire feature '.repeat(20),
        reason: 'Objective achieved',
      },
    })

    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.body.length).toBeLessThanOrEqual(140)
    expect(payload.body).toContain('Objective achieved')
    expect(payload.body).toContain('…')
  })

  it('omits the reason when the goal has none', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...goalOutcome,
      goal: { ...completedGoal, reason: undefined },
    })

    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.body).toContain('Ship the feature')
    expect(payload.body).not.toContain(' — ')
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

    await service.notifyGoalOutcome(goalOutcome)

    expect(send).not.toHaveBeenCalled()
  })

  it('does not notify while the goal session is being viewed', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSessionBeingViewed').mockReturnValue(true)

    await service.notifyGoalOutcome(goalOutcome)

    expect(send).not.toHaveBeenCalled()
  })

  it('notifies a complete goal whose rounds reached the maximum', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.notifyGoalOutcome({
      ...goalOutcome,
      goal: { ...completedGoal, rounds: 5, maxRounds: 5 },
    })

    expect(send).toHaveBeenCalledTimes(1)
  })
})
