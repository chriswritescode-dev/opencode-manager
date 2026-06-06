import { QueryClient } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { createPartsBatcher } from './partsBatcher'
import type { Part, MessageWithParts } from '@/api/types'

function assistantMessage(sessionID: string, messageID: string): MessageWithParts {
  return {
    info: {
      id: messageID,
      sessionID,
      role: 'assistant',
      time: { created: Date.now() },
      parentID: '',
      modelID: 'test-model',
      providerID: 'test-provider',
      mode: 'test',
      agent: 'test-agent',
      path: { cwd: '/test', root: '/test' },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [],
  }
}

function textPart(sessionID: string, messageID: string, partID: string, text: string): Part {
  return { id: partID, sessionID, messageID, type: 'text', text } as Part
}

function createManyCachedMessages(count: number, sessionID: string): MessageWithParts[] {
  const messages: MessageWithParts[] = []
  for (let i = 0; i < count; i++) {
    const msg = assistantMessage(sessionID, `msg-${i}`)
    msg.parts = [textPart(sessionID, `msg-${i}`, `part-${i}`, `base text ${i}`)]
    messages.push(msg)
  }
  return messages
}

describe('createPartsBatcher', () => {
  it('invalidates when part deltas arrive before message cache exists and applies a later authoritative upsert', () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    batcher.queuePartDelta('session-1', 'message-1', 'part-1', 'text', 'Hello', '/repo')
    batcher.flush()

    expect(
      queryClient.getQueryData(['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo']),
    ).toBeUndefined()

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
    })

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [assistantMessage('session-1', 'message-1')],
    )

    batcher.queuePartUpdate('session-1', textPart('session-1', 'message-1', 'part-1', 'Hello world'), '/repo')
    batcher.flush()

    const data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data).toHaveLength(1)
    expect(data![0].parts).toHaveLength(1)
    expect(data![0].parts[0]).toHaveProperty('text', 'Hello world')
  })

  it('does not replay stale deltas after authoritative upsert resolves the part', () => {
    const queryClient = new QueryClient()
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    batcher.queuePartDelta('session-1', 'message-1', 'part-1', 'text', 'stale delta ', '/repo')
    batcher.flush()

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [assistantMessage('session-1', 'message-1')],
    )

    batcher.queuePartUpdate('session-1', textPart('session-1', 'message-1', 'part-1', 'authoritative text'), '/repo')
    batcher.flush()

    const data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data![0].parts).toHaveLength(1)
    expect(data![0].parts[0]).toHaveProperty('text', 'authoritative text')

    batcher.flush()
    const data2 = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data2![0].parts[0]).toHaveProperty('text', 'authoritative text')
  })

  it('does not replay unapplied deltas onto refetched authoritative data', () => {
    const queryClient = new QueryClient()
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [assistantMessage('session-1', 'message-1')],
    )

    batcher.queuePartDelta('session-1', 'message-1', 'part-1', 'text', ' stale', '/repo')
    batcher.flush()

    let data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data![0].parts[0]).toHaveProperty('text', ' stale')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [{ ...assistantMessage('session-1', 'message-1'), parts: [textPart('session-1', 'message-1', 'part-1', 'fresh')] }],
    )

    batcher.flush()

    data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data![0].parts[0]).toHaveProperty('text', 'fresh')
  })

  it('keeps text deltas pending until a later message update creates the assistant message', () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [assistantMessage('session-1', 'message-old')],
    )

    batcher.queuePartDelta('session-1', 'message-new', 'part-1', 'text', 'streamed', '/repo')
    batcher.flush()

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
    })

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [assistantMessage('session-1', 'message-old'), assistantMessage('session-1', 'message-new')],
    )

    batcher.flush({ sessionID: 'session-1', directory: '/repo' })

    const data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data![1].parts).toHaveLength(1)
    expect(data![1].parts[0]).toMatchObject({
      id: 'part-1',
      sessionID: 'session-1',
      messageID: 'message-new',
      type: 'text',
      text: 'streamed',
    })
  })

  it('applies deltas queued after an authoritative upsert in the same batch', () => {
    const queryClient = new QueryClient()
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [assistantMessage('session-1', 'message-1')],
    )

    batcher.queuePartUpdate('session-1', textPart('session-1', 'message-1', 'part-1', 'snapshot'), '/repo')
    batcher.queuePartDelta('session-1', 'message-1', 'part-1', 'text', ' later', '/repo')
    batcher.flush()

    const data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data![0].parts).toHaveLength(1)
    expect(data![0].parts[0]).toHaveProperty('text', 'snapshot later')
  })

  it('applies many queued part deltas with one cache write and no invalidation storm', () => {
    const queryClient = new QueryClient()
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    const sessionID = 'session-1'
    const directory = '/repo'
    const messageCount = 1000
    const deltaCount = 500

    const messages = createManyCachedMessages(messageCount, sessionID)
    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', sessionID, directory],
      messages,
    )

    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    for (let i = 0; i < deltaCount; i++) {
      batcher.queuePartDelta(sessionID, `msg-${i}`, `part-${i}`, 'text', ` delta ${i}`, directory)
    }

    batcher.flush()

    expect(invalidateSpy).not.toHaveBeenCalled()

    const data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', sessionID, directory,
    ])
    expect(data).toHaveLength(messageCount)

    for (let i = 0; i < deltaCount; i++) {
      expect(data![i].parts[0]).toHaveProperty('text', `base text ${i} delta ${i}`)
    }

    for (let i = deltaCount; i < messageCount; i++) {
      expect(data![i].parts[0]).toHaveProperty('text', `base text ${i}`)
    }

    const setQueryDataCalls = setQueryDataSpy.mock.calls.filter(
      ([key]) => JSON.stringify(key).includes('opencode'),
    )
    expect(setQueryDataCalls.length).toBe(1)
  })

  it('does not apply same-batch deltas for removed parts to shifted parts', () => {
    const queryClient = new QueryClient()
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [{
        ...assistantMessage('session-1', 'message-1'),
        parts: [
          textPart('session-1', 'message-1', 'part-1', 'first'),
          textPart('session-1', 'message-1', 'part-2', 'second'),
        ],
      }],
    )

    batcher.queuePartRemoval('session-1', 'message-1', 'part-1', '/repo')
    batcher.queuePartDelta('session-1', 'message-1', 'part-1', 'text', ' stale', '/repo')
    batcher.flush()

    const data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])

    expect(data![0].parts).toHaveLength(1)
    expect(data![0].parts[0]).toHaveProperty('id', 'part-2')
    expect(data![0].parts[0]).toHaveProperty('text', 'second')
  })

  it('targeted flush leaves other session groups pending', () => {
    const queryClient = new QueryClient()
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-a', '/repo-a'],
      [{ ...assistantMessage('session-a', 'msg-1'), parts: [textPart('session-a', 'msg-1', 'part-1', 'A1')] }],
    )
    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-b', '/repo-b'],
      [{ ...assistantMessage('session-b', 'msg-2'), parts: [textPart('session-b', 'msg-2', 'part-2', 'B1')] }],
    )

    batcher.queuePartDelta('session-a', 'msg-1', 'part-1', 'text', ' delta A', '/repo-a')
    batcher.queuePartDelta('session-b', 'msg-2', 'part-2', 'text', ' delta B', '/repo-b')

    batcher.flush({ sessionID: 'session-a', directory: '/repo-a' })

    const dataA = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-a', '/repo-a',
    ])
    expect(dataA![0].parts[0]).toHaveProperty('text', 'A1 delta A')

    const dataB = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-b', '/repo-b',
    ])
    expect(dataB![0].parts[0]).toHaveProperty('text', 'B1')

    batcher.flush()

    const dataB2 = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-b', '/repo-b',
    ])
    expect(dataB2![0].parts[0]).toHaveProperty('text', 'B1 delta B')
  })

  it('empty group is dropped without invalidate', () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [{ ...assistantMessage('session-1', 'msg-1'), parts: [textPart('session-1', 'msg-1', 'part-1', 'text')] }],
    )

    batcher.queuePartDelta('session-1', 'msg-1', 'part-1', 'text', ' updated', '/repo')
    batcher.flush({ sessionID: 'session-1', directory: '/repo' })

    invalidateSpy.mockClear()
    batcher.flush()

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('applies deltas to the directory they were queued for', () => {
    const queryClient = new QueryClient()
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-a'],
      [assistantMessage('session-1', 'message-1')],
    )
    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-b'],
      [{ ...assistantMessage('session-1', 'message-1'), parts: [textPart('session-1', 'message-1', 'part-1', 'B')] }],
    )

    batcher.queuePartDelta('session-1', 'message-1', 'part-1', 'text', ' + chunk', '/repo-b')
    batcher.flush()

    const repoBData = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-b',
    ])
    expect(repoBData![0].parts[0]).toHaveProperty('text', 'B + chunk')

    const repoAData = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo-a',
    ])
    expect(repoAData![0].parts).toHaveLength(0)
  })
})
