import { describe, expect, it } from 'vitest'
import type { V2Event } from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import {
  SESSION_REPLY_MAX_LENGTH,
  getLatestAssistantReplyState,
  isSessionBusy,
  isSessionBusyIn,
  readLatestAssistantReply,
  sessionSettleSignal,
  truncateSessionReply,
  waitForSessionSettled,
  type ActiveSessions,
} from '../../src/services/session-reply'
import { sseAggregator } from '../../src/services/sse-aggregator'
import type { ScheduleApiState } from '../helpers/stub-schedule-api'
import { assistantMessage, createStubScheduleApi, createStubScheduleClient } from '../helpers/stub-schedule-api'

function createClient(state: Partial<ScheduleApiState> = {}) {
  const stub = createStubScheduleApi(state)
  return { api: stub.api, client: createStubScheduleClient(stub) }
}

function durableEvent(sessionID: string) {
  return { aggregateID: sessionID, seq: 1, version: 1 as const }
}

function idleEvent(sessionID: string): V2Event {
  return { id: 'evt_idle', created: 0, type: 'session.idle', data: { sessionID } }
}

function executionSucceededEvent(sessionID: string): V2Event {
  return { id: 'evt_succeeded', created: 0, type: 'session.execution.succeeded', durable: durableEvent(sessionID), data: { sessionID } }
}

function executionStartedEvent(sessionID: string): V2Event {
  return { id: 'evt_started', created: 0, type: 'session.execution.started', durable: durableEvent(sessionID), data: { sessionID } }
}

function executionInterruptedEvent(sessionID: string): V2Event {
  return {
    id: 'evt_interrupted',
    created: 0,
    type: 'session.execution.interrupted',
    durable: durableEvent(sessionID),
    data: { sessionID, reason: 'user' },
  }
}

function executionFailedEvent(sessionID: string, message: string): V2Event {
  return {
    id: 'evt_failed',
    created: 0,
    type: 'session.execution.failed',
    durable: durableEvent(sessionID),
    data: { sessionID, error: { type: 'provider', message } },
  }
}

function sessionStatusEvent(sessionID: string, type: 'idle' | 'busy'): V2Event {
  return { id: 'evt_status', created: 0, type: 'session.status', data: { sessionID, status: { type } } }
}

describe('getLatestAssistantReplyState', () => {
  it('returns the newest assistant text with think blocks stripped', () => {
    const state = getLatestAssistantReplyState([
      assistantMessage('', {
        completed: true,
        content: [
          { type: 'text', text: '\u003cthink\u003eprivate reasoning\u003c/think\u003e\nFinal answer' },
          { type: 'text', text: 'Second paragraph.' },
        ],
      }),
    ])

    expect(state).toEqual({
      responseText: 'Final answer\n\nSecond paragraph.',
      errorText: null,
      completed: true,
    })
  })

  it('surfaces the assistant error message', () => {
    const state = getLatestAssistantReplyState([
      assistantMessage('', { error: 'Provider exploded' }),
    ])

    expect(state).toEqual({
      responseText: null,
      errorText: 'Provider exploded',
      completed: false,
    })
  })

  it('reports an incomplete assistant message as not completed', () => {
    const state = getLatestAssistantReplyState([assistantMessage('Partial output')])

    expect(state).toEqual({
      responseText: 'Partial output',
      errorText: null,
      completed: false,
    })
  })

  it('returns null when no assistant message is present', () => {
    expect(getLatestAssistantReplyState([])).toBeNull()
  })
})

describe('readLatestAssistantReply', () => {
  it('reads the newest assistant reply through the client', async () => {
    const { api, client } = createClient({ messages: [assistantMessage('From the client.', { completed: true })] })

    await expect(readLatestAssistantReply(client, 'ses-1')).resolves.toEqual({
      responseText: 'From the client.',
      errorText: null,
      completed: true,
    })
    expect(api.message.list).toHaveBeenCalledWith({
      sessionID: 'ses-1',
      order: 'desc',
      limit: 20,
    })
  })

  it('returns null when the session has no assistant message', async () => {
    await expect(readLatestAssistantReply(createClient().client, 'ses-1')).resolves.toBeNull()
  })
})

describe('isSessionBusy', () => {
  it('is true when the session appears in the active set', async () => {
    const { client } = createClient({ active: { 'ses-1': { type: 'running' } } })

    await expect(isSessionBusy(client, 'ses-1')).resolves.toBe(true)
  })

  it('is false when the session is absent from the active set', async () => {
    await expect(isSessionBusy(createClient().client, 'ses-1')).resolves.toBe(false)
  })
})

describe('isSessionBusyIn', () => {
  const busy: ActiveSessions = { 'ses-1': { type: 'running' } }
  const idle: ActiveSessions = {}

  it('is true when the session appears in the fetched active set', () => {
    expect(isSessionBusyIn(busy, 'ses-1')).toBe(true)
  })

  it('is false when the session is absent from the fetched active set', () => {
    expect(isSessionBusyIn(idle, 'ses-1')).toBe(false)
  })
})

describe('truncateSessionReply', () => {
  it('returns short replies unchanged', () => {
    expect(truncateSessionReply('short reply')).toBe('short reply')
  })

  it('caps long replies and appends a truncation marker', () => {
    const reply = 'x'.repeat(SESSION_REPLY_MAX_LENGTH + 25)
    const truncated = truncateSessionReply(reply)

    expect(truncated.startsWith('x'.repeat(SESSION_REPLY_MAX_LENGTH))).toBe(true)
    expect(truncated.endsWith('[reply truncated]')).toBe(true)
    expect(truncated).not.toContain('x'.repeat(SESSION_REPLY_MAX_LENGTH + 1))
  })
})

describe('sessionSettleSignal', () => {
  it('signals a clean settle for idle, succeeded, and status idle events', () => {
    expect(sessionSettleSignal(idleEvent('s1'), 's1')).toEqual({ errorText: null })
    expect(sessionSettleSignal(executionSucceededEvent('s1'), 's1')).toEqual({ errorText: null })
    expect(sessionSettleSignal(sessionStatusEvent('s1', 'idle'), 's1')).toEqual({ errorText: null })
  })

  it('signals a failure with the reported error message', () => {
    expect(sessionSettleSignal(executionFailedEvent('s1', 'boom'), 's1')).toEqual({ errorText: 'boom' })
    expect(sessionSettleSignal(executionFailedEvent('s1', ''), 's1')).toEqual({
      errorText: 'The session reported an unknown error.',
    })
  })

  it('signals an interruption', () => {
    expect(sessionSettleSignal(executionInterruptedEvent('s1'), 's1')).toEqual({
      errorText: 'The session execution was interrupted.',
    })
  })

  it('ignores events for other sessions and non-settling events', () => {
    expect(sessionSettleSignal(idleEvent('s2'), 's1')).toBeNull()
    expect(sessionSettleSignal(sessionStatusEvent('s1', 'busy'), 's1')).toBeNull()
    expect(sessionSettleSignal(executionStartedEvent('s1'), 's1')).toBeNull()
  })
})

describe('waitForSessionSettled', () => {
  function notify(event: V2Event, serverId: string = LOCAL_OPENCODE_SERVER_ID): void {
    sseAggregator.notifyServerEvent(serverId, null, event)
  }

  it('resolves immediately when the timeout is zero', async () => {
    const { client } = createClient({ active: { 'ses-1': { type: 'running' } } })

    await expect(waitForSessionSettled(client, 'ses-1', 0)).resolves.toBeUndefined()
  })

  it('resolves once the session settles', async () => {
    const { client } = createClient({ active: { 'ses-1': { type: 'running' } } })

    const settled = waitForSessionSettled(client, 'ses-1', 1000)
    notify(idleEvent('ses-1'))

    await expect(settled).resolves.toBeUndefined()
  })

  it('ignores settle events for other sessions', async () => {
    const { client } = createClient({ active: { 'ses-1': { type: 'running' } } })

    const settled = waitForSessionSettled(client, 'ses-1', 1000)
    notify(idleEvent('ses-2'))

    await new Promise((resolve) => setTimeout(resolve, 10))
    let resolved = false
    void settled.then(() => { resolved = true })
    expect(resolved).toBe(false)

    notify(idleEvent('ses-1'))
    await expect(settled).resolves.toBeUndefined()
  })

  it('resolves immediately when the session is no longer busy after subscribing', async () => {
    const { client } = createClient()

    await expect(waitForSessionSettled(client, 'ses-1', 1000)).resolves.toBeUndefined()
  })

  it('resolves on timeout', async () => {
    const { client } = createClient({ active: { 'ses-1': { type: 'running' } } })

    await expect(waitForSessionSettled(client, 'ses-1', 20)).resolves.toBeUndefined()
  })

  it('ignores settle events from other servers when a server id is provided', async () => {
    const { client } = createClient({ active: { 'ses-1': { type: 'running' } } })

    const settled = waitForSessionSettled(client, 'ses-1', 1000, 'srv_a')
    notify(idleEvent('ses-1'), LOCAL_OPENCODE_SERVER_ID)

    await new Promise((resolve) => setTimeout(resolve, 10))
    let resolved = false
    void settled.then(() => { resolved = true })
    expect(resolved).toBe(false)

    notify(idleEvent('ses-1'), 'srv_a')
    await expect(settled).resolves.toBeUndefined()
  })
})
