import { describe, it, expect } from 'vitest'
import { getMessagesContentVersion } from '../sessionContentVersion'
import type { MessageWithParts } from '@/api/types'

const baseMessage: Pick<MessageWithParts['info'], 'id' | 'role' | 'time'> = {
  id: 'msg-1',
  role: 'assistant',
  time: { start: 1000 },
}

function makeMessage(parts: MessageWithParts['parts']): MessageWithParts {
  return { info: { ...baseMessage, id: 'msg-1' }, parts }
}

describe('getMessagesContentVersion', () => {
  it('returns 0 for undefined', () => {
    expect(getMessagesContentVersion(undefined)).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(getMessagesContentVersion([])).toBe(0)
  })

  it('is stable across two calls with the same input', () => {
    const msgs = [makeMessage([
      { type: 'text', id: 'p1', sessionID: 's1', messageID: 'm1', text: 'hello' },
    ])]
    const v1 = getMessagesContentVersion(msgs)
    const v2 = getMessagesContentVersion(msgs)
    expect(v1).toBe(v2)
  })

  it('changes when a text part text is extended', () => {
    const msgs = [makeMessage([
      { type: 'text', id: 'p1', sessionID: 's1', messageID: 'm1', text: 'hello' },
    ])]
    const v1 = getMessagesContentVersion(msgs)

    const msgs2 = [makeMessage([
      { type: 'text', id: 'p1', sessionID: 's1', messageID: 'm1', text: 'hello world' },
    ])]
    const v2 = getMessagesContentVersion(msgs2)

    expect(v2).not.toBe(v1)
  })

  it('changes when a tool part output changes', () => {
    const msgs = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'completed' as const, input: {}, output: 'foo', title: 't', metadata: {}, time: { start: 1000, end: 2000 } },
      },
    ])]
    const v1 = getMessagesContentVersion(msgs)

    const msgs2 = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'completed' as const, input: {}, output: 'foobar', title: 't', metadata: {}, time: { start: 1000, end: 2000 } },
      },
    ])]
    const v2 = getMessagesContentVersion(msgs2)

    expect(v2).not.toBe(v1)
  })

  it('changes when a tool part status transitions', () => {
    const pendingMsgs = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'pending' as const, input: {}, raw: '{}' },
      },
    ])]
    const vPending = getMessagesContentVersion(pendingMsgs)

    const runningMsgs = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'running' as const, input: {}, time: { start: 1000 } },
      },
    ])]
    const vRunning = getMessagesContentVersion(runningMsgs)

    expect(vRunning).not.toBe(vPending)
  })

  it('changes when a tool part has an error', () => {
    const msgsOk = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'completed' as const, input: {}, output: '', title: 't', metadata: {}, time: { start: 1000, end: 2000 } },
      },
    ])]
    const vOk = getMessagesContentVersion(msgsOk)

    const msgsError = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'error' as const, input: {}, error: 'Failed to read', metadata: {}, time: { start: 1000, end: 2000 } },
      },
    ])]
    const vError = getMessagesContentVersion(msgsError)

    expect(vError).not.toBe(vOk)
  })

  it('accounts for reasoning part text length', () => {
    const msgs = [makeMessage([
      { type: 'reasoning', id: 'p1', sessionID: 's1', messageID: 'm1', text: 'thinking...' },
    ])]
    expect(getMessagesContentVersion(msgs)).toBeGreaterThan(0)
  })

  it('changes when tool status transitions between same-length strings', () => {
    // 'pending' and 'running' are both 7 characters – length-only
    // versioning would miss this.
    const pendingMsgs = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'pending' as const, input: {} },
      },
    ])]
    const vPending = getMessagesContentVersion(pendingMsgs)

    const runningMsgs = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'running' as const, input: {} },
      },
    ])]
    const vRunning = getMessagesContentVersion(runningMsgs)

    expect(vRunning).not.toBe(vPending)
  })

  it('changes when tool output changes to different text of the same length', () => {
    const msgsFoo = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'completed' as const, input: {}, output: 'foo', metadata: {}, time: { start: 1000, end: 2000 } },
      },
    ])]
    const vFoo = getMessagesContentVersion(msgsFoo)

    const msgsBar = [makeMessage([
      {
        type: 'tool', id: 'p1', sessionID: 's1', messageID: 'm1',
        callID: 'c1', tool: 'read',
        state: { status: 'completed' as const, input: {}, output: 'bar', metadata: {}, time: { start: 1000, end: 2000 } },
      },
    ])]
    const vBar = getMessagesContentVersion(msgsBar)

    expect(vBar).not.toBe(vFoo)
  })
})
