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
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const batcher = createPartsBatcher(queryClient, 'http://localhost:5551')

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [assistantMessage('session-1', 'message-1')],
    )

    batcher.queuePartDelta('session-1', 'message-1', 'part-1', 'text', ' stale', '/repo')
    batcher.flush()

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
    })

    queryClient.setQueryData(
      ['opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo'],
      [{ ...assistantMessage('session-1', 'message-1'), parts: [textPart('session-1', 'message-1', 'part-1', 'fresh')] }],
    )

    batcher.flush()

    const data = queryClient.getQueryData<MessageWithParts[]>([
      'opencode', 'messages', 'http://localhost:5551', 'session-1', '/repo',
    ])
    expect(data![0].parts[0]).toHaveProperty('text', 'fresh')
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
