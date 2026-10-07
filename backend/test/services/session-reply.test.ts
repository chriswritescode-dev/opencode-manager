import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'
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
import { assistantMessage } from '../helpers/stub-schedule-api'

const mockOnEvent = vi.fn()
vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: { onEvent: (...args: unknown[]) => mockOnEvent(...args) },
}))

beforeEach(() => {
  mockOnEvent.mockReset()
})

function createFakeClient(messages: SessionMessageInfo[], active: Record<string, unknown> = {}): OpenCodeClient {
  return {
    api: {
      message: {
        list: vi.fn(async () => ({ data: messages, cursor: {} })),
      },
      session: {
        active: vi.fn(async () => active),
      },
    },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient
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
    const client = createFakeClient([assistantMessage('From the client.', { completed: true })])

    await expect(readLatestAssistantReply(client, 'ses-1')).resolves.toEqual({
      responseText: 'From the client.',
      errorText: null,
      completed: true,
    })
    expect(client.api.message.list).toHaveBeenCalledWith({
      sessionID: 'ses-1',
      order: 'desc',
      limit: 20,
    })
  })

  it('returns null when the session has no assistant message', async () => {
    await expect(readLatestAssistantReply(createFakeClient([]), 'ses-1')).resolves.toBeNull()
  })
})

describe('isSessionBusy', () => {
  it('is true when the session appears in the active set', async () => {
    const client = createFakeClient([], { 'ses-1': { type: 'running' } })

    await expect(isSessionBusy(client, 'ses-1')).resolves.toBe(true)
  })

  it('is false when the session is absent from the active set', async () => {
    await expect(isSessionBusy(createFakeClient([], {}), 'ses-1')).resolves.toBe(false)
  })
})

describe('isSessionBusyIn', () => {
  it('is true when the session appears in the fetched active set', () => {
    expect(isSessionBusyIn({ 'ses-1': { type: 'running' } } as unknown as ActiveSessions, 'ses-1')).toBe(true)
  })

  it('is false when the session is absent from the fetched active set', () => {
    expect(isSessionBusyIn({} as unknown as ActiveSessions, 'ses-1')).toBe(false)
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
    expect(sessionSettleSignal({ type: 'session.idle', data: { sessionID: 's1' } } as never, 's1')).toEqual({ errorText: null })
    expect(sessionSettleSignal({ type: 'session.execution.succeeded', data: { sessionID: 's1' } } as never, 's1')).toEqual({ errorText: null })
    expect(sessionSettleSignal({ type: 'session.status', data: { sessionID: 's1', status: { type: 'idle' } } } as never, 's1')).toEqual({ errorText: null })
  })

  it('signals a failure with the reported error message', () => {
    expect(sessionSettleSignal({ type: 'session.execution.failed', data: { sessionID: 's1', error: { message: 'boom' } } } as never, 's1')).toEqual({ errorText: 'boom' })
    expect(sessionSettleSignal({ type: 'session.execution.failed', data: { sessionID: 's1', error: { message: '' } } } as never, 's1')).toEqual({ errorText: 'The session reported an unknown error.' })
  })

  it('signals an interruption', () => {
    expect(sessionSettleSignal({ type: 'session.execution.interrupted', data: { sessionID: 's1' } } as never, 's1')).toEqual({ errorText: 'The session execution was interrupted.' })
  })

  it('ignores events for other sessions and non-settling events', () => {
    expect(sessionSettleSignal({ type: 'session.idle', data: { sessionID: 's2' } } as never, 's1')).toBeNull()
    expect(sessionSettleSignal({ type: 'session.status', data: { sessionID: 's1', status: { type: 'busy' } } } as never, 's1')).toBeNull()
    expect(sessionSettleSignal({ type: 'session.execution.started', data: { sessionID: 's1' } } as never, 's1')).toBeNull()
  })
})

describe('waitForSessionSettled', () => {
  function captureListener() {
    let listener: ((directory: string, event: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    mockOnEvent.mockImplementation((callback: (directory: string, event: unknown) => void) => {
      listener = callback
      return unsubscribe
    })
    return {
      emit: (event: unknown) => listener?.('', event),
      unsubscribe,
    }
  }

  it('does not subscribe when the timeout is zero', async () => {
    const client = createFakeClient([], { 'ses-1': {} })

    await expect(waitForSessionSettled(client, 'ses-1', 0)).resolves.toBeUndefined()
    expect(mockOnEvent).not.toHaveBeenCalled()
  })

  it('resolves once the session settles and unsubscribes', async () => {
    const client = createFakeClient([], { 'ses-1': {} })
    const { emit, unsubscribe } = captureListener()

    const settled = waitForSessionSettled(client, 'ses-1', 1000)
    emit({ type: 'session.idle', data: { sessionID: 'ses-1' } })

    await expect(settled).resolves.toBeUndefined()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('ignores settle events for other sessions', async () => {
    const client = createFakeClient([], { 'ses-1': {} })
    const { emit, unsubscribe } = captureListener()

    const settled = waitForSessionSettled(client, 'ses-1', 1000)
    emit({ type: 'session.idle', data: { sessionID: 'ses-2' } })
    expect(unsubscribe).not.toHaveBeenCalled()

    emit({ type: 'session.idle', data: { sessionID: 'ses-1' } })
    await expect(settled).resolves.toBeUndefined()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('resolves immediately when the session is no longer busy after subscribing', async () => {
    const client = createFakeClient([], {})
    const { unsubscribe } = captureListener()

    await expect(waitForSessionSettled(client, 'ses-1', 1000)).resolves.toBeUndefined()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('resolves on timeout and unsubscribes', async () => {
    const client = createFakeClient([], { 'ses-1': {} })
    const { unsubscribe } = captureListener()

    await expect(waitForSessionSettled(client, 'ses-1', 20)).resolves.toBeUndefined()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
