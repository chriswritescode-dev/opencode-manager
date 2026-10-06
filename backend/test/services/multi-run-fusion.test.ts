import { describe, expect, it, vi } from 'vitest'
import type {
  FileDiffInfo,
  SessionInfo,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import { FUSION_PROMPT_MAX_LENGTH } from '@opencode-manager/shared/schemas'
import type { MultiRunEntryRecord } from '../../src/db/multi-runs'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import {
  FUSION_MIN_SOURCE_CONTEXT,
  FusionContextLimitError,
  buildFusionPrompt,
  collectFusionSources,
  type CollectedFusionSource,
} from '../../src/services/multi-run-fusion'
import { SESSION_REPLY_TRUNCATION_MARKER } from '../../src/services/session-reply'
import { assistantMessage } from '../helpers/stub-schedule-api'

function entry(overrides: Partial<MultiRunEntryRecord> = {}): MultiRunEntryRecord {
  return {
    id: 1,
    model: 'openai/gpt-5',
    status: 'started',
    sessionId: 'ses-1',
    directory: '/worktrees/run-1',
    isolated: true,
    error: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return { id: 'ses-1', outcome: 'succeeded', ...overrides } as SessionInfo
}

function userMessage(id: string): SessionMessageInfo {
  return { id, type: 'user', time: { created: 0 }, text: id } as SessionMessageInfo
}

interface FakeSession {
  info?: SessionInfo | Error
  busy?: boolean
  activeError?: Error
  messages?: SessionMessageInfo[] | Error
  firstUser?: SessionMessageInfo
  lastUser?: SessionMessageInfo
  diff?: FileDiffInfo[] | Error
}

function createFakeClient(sessions: Record<string, FakeSession>) {
  const sessionGet = vi.fn(async ({ sessionID }: { sessionID: string }) => {
    const config = sessions[sessionID]
    if (config?.info instanceof Error) {
      throw config.info
    }
    return config?.info ?? sessionInfo({ id: sessionID })
  })

  const sessionActive = vi.fn(async () => {
    const active: Record<string, unknown> = {}
    for (const [id, config] of Object.entries(sessions)) {
      if (config.activeError) {
        throw config.activeError
      }
      if (config.busy) {
        active[id] = { type: 'running' }
      }
    }
    return active
  })

  const messageList = vi.fn(async (input: { sessionID: string; type?: string; order?: 'asc' | 'desc' }) => {
    const config = sessions[input.sessionID]
    if (input.type === 'user') {
      const message = input.order === 'asc' ? config?.firstUser : config?.lastUser
      return { data: message ? [message] : [], cursor: {} }
    }
    if (config?.messages instanceof Error) {
      throw config.messages
    }
    return { data: config?.messages ?? [], cursor: {} }
  })

  const sessionDiff = vi.fn(async ({ sessionID }: { sessionID: string }) => {
    const config = sessions[sessionID]
    if (config?.diff instanceof Error) {
      throw config.diff
    }
    return config?.diff ?? []
  })

  const sessionPrompt = vi.fn(async () => ({}))
  const sessionCreate = vi.fn(async () => ({}))
  const sessionInterrupt = vi.fn(async () => ({}))

  const client = {
    api: {
      session: {
        get: sessionGet,
        active: sessionActive,
        diff: sessionDiff,
        prompt: sessionPrompt,
        create: sessionCreate,
        interrupt: sessionInterrupt,
      },
      message: { list: messageList },
    },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient

  return { client, sessionGet, sessionActive, messageList, sessionDiff, sessionPrompt, sessionCreate, sessionInterrupt }
}

function notFoundError(): Error {
  return Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
}

function fusionSource(overrides: Partial<CollectedFusionSource> = {}): CollectedFusionSource {
  return {
    entryId: 1,
    model: 'openai/gpt-5',
    sessionId: 'ses-1',
    directory: '/worktrees/run-1',
    outcome: 'succeeded',
    replyText: 'Final reply',
    changes: [],
    ...overrides,
  }
}

function fileDiff(file: string, patch: string, overrides: Partial<FileDiffInfo> = {}): FileDiffInfo {
  return { file, patch, additions: 1, deletions: 1, status: 'modified', ...overrides }
}

describe('collectFusionSources', () => {
  it('returns a completed idle session in ready with its reply, outcome and changes', async () => {
    const changes: FileDiffInfo[] = [
      { file: 'src/a.ts', patch: '@@ -1 +1 @@', additions: 1, deletions: 1, status: 'modified' },
    ]
    const { client, sessionDiff } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1', outcome: 'succeeded' }),
        messages: [assistantMessage('Final answer', { completed: true })],
        firstUser: userMessage('msg-first'),
        lastUser: userMessage('msg-last'),
        diff: changes,
      },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([])
    expect(result.ready).toEqual([
      {
        entryId: 1,
        model: 'openai/gpt-5',
        sessionId: 'ses-1',
        directory: '/worktrees/run-1',
        outcome: 'succeeded',
        replyText: 'Final answer',
        changes,
      },
    ])
    expect(sessionDiff).toHaveBeenCalledWith({
      sessionID: 'ses-1',
      from: 'msg-first',
      to: 'msg-last',
      context: 3,
    })
  })

  it('reports a null outcome for a session that never settled', async () => {
    const { client } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1', outcome: undefined }),
        messages: [assistantMessage('Done', { completed: true })],
        diff: [],
      },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.ready[0]?.outcome).toBeNull()
  })

  it('classifies entries that have not started as not-started without reading them', async () => {
    const { client, sessionGet } = createFakeClient({})

    const result = await collectFusionSources(client, [
      entry({ id: 1, status: 'failed', sessionId: null }),
      entry({ id: 2, status: 'discarded', sessionId: 'ses-2' }),
    ])

    expect(result.ready).toEqual([])
    expect(result.unavailable.map((source) => source.reason)).toEqual(['not-started', 'not-started'])
    expect(result.unavailable.map((source) => source.entryId)).toEqual([1, 2])
    expect(sessionGet).not.toHaveBeenCalled()
  })

  it('classifies a deleted session as missing', async () => {
    const { client } = createFakeClient({ 'ses-1': { info: notFoundError() } })

    const result = await collectFusionSources(client, [entry()])

    expect(result.ready).toEqual([])
    expect(result.unavailable).toEqual([
      { entryId: 1, model: 'openai/gpt-5', reason: 'missing', message: expect.any(String) },
    ])
  })

  it('classifies a busy session as running without reading its reply', async () => {
    const { client, messageList } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1' }),
        busy: true,
        messages: [assistantMessage('Still going', { completed: true })],
      },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([
      { entryId: 1, model: 'openai/gpt-5', reason: 'running', message: expect.any(String) },
    ])
    expect(messageList).not.toHaveBeenCalled()
  })

  it('classifies a session without an assistant reply as incomplete', async () => {
    const { client } = createFakeClient({ 'ses-1': { info: sessionInfo({ id: 'ses-1' }), messages: [] } })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([
      { entryId: 1, model: 'openai/gpt-5', reason: 'incomplete', message: expect.any(String) },
    ])
  })

  it('classifies an unfinished assistant reply as incomplete', async () => {
    const { client } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1' }),
        messages: [assistantMessage('Partial output', { completed: false })],
      },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([
      { entryId: 1, model: 'openai/gpt-5', reason: 'incomplete', message: expect.any(String) },
    ])
  })

  it('classifies a failed session as failed and includes the error text', async () => {
    const { client } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1', outcome: 'failed' }),
        messages: [assistantMessage('', { completed: true, error: 'Provider exploded' })],
      },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([
      {
        entryId: 1,
        model: 'openai/gpt-5',
        reason: 'failed',
        message: expect.stringContaining('Provider exploded'),
      },
    ])
  })

  it('classifies an interrupted session as failed', async () => {
    const { client } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1', outcome: 'interrupted' }),
        messages: [assistantMessage('Stopped early', { completed: true })],
      },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([
      {
        entryId: 1,
        model: 'openai/gpt-5',
        reason: 'failed',
        message: expect.stringContaining('interrupted'),
      },
    ])
  })

  it('classifies a session read error as unavailable with the error message', async () => {
    const { client } = createFakeClient({ 'ses-1': { info: new Error('connection reset') } })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([
      { entryId: 1, model: 'openai/gpt-5', reason: 'unavailable', message: 'connection reset' },
    ])
  })

  it('classifies a busy-check error as unavailable', async () => {
    const { client } = createFakeClient({
      'ses-1': { info: sessionInfo({ id: 'ses-1' }), activeError: new Error('active boom') },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([
      { entryId: 1, model: 'openai/gpt-5', reason: 'unavailable', message: 'active boom' },
    ])
  })

  it('keeps a source ready with changes null when the diff read fails', async () => {
    const { client } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1' }),
        messages: [assistantMessage('Done', { completed: true })],
        firstUser: userMessage('msg-first'),
        lastUser: userMessage('msg-last'),
        diff: new Error('turn range invalid'),
      },
    })

    const result = await collectFusionSources(client, [entry()])

    expect(result.unavailable).toEqual([])
    expect(result.ready).toEqual([
      expect.objectContaining({ entryId: 1, replyText: 'Done', changes: null }),
    ])
  })

  it('collects every entry concurrently and splits ready from unavailable', async () => {
    const { client } = createFakeClient({
      'ses-ready': {
        info: sessionInfo({ id: 'ses-ready' }),
        messages: [assistantMessage('Ready reply', { completed: true })],
        diff: [],
      },
      'ses-busy': { info: sessionInfo({ id: 'ses-busy' }), busy: true },
    })

    const result = await collectFusionSources(client, [
      entry({ id: 1, model: 'openai/a', sessionId: 'ses-ready' }),
      entry({ id: 2, model: 'openai/b', sessionId: 'ses-busy' }),
      entry({ id: 3, model: 'openai/c', sessionId: null, status: 'starting' }),
    ])

    expect(result.ready.map((source) => source.entryId)).toEqual([1])
    expect(result.unavailable.map((source) => source.entryId)).toEqual([2, 3])
    expect(result.unavailable.map((source) => source.reason)).toEqual(['running', 'not-started'])
  })

  it('reads the active-session map once for multiple started sources', async () => {
    const { client, sessionActive } = createFakeClient({
      'ses-a': {
        info: sessionInfo({ id: 'ses-a' }),
        messages: [assistantMessage('Reply A', { completed: true })],
        diff: [],
      },
      'ses-b': {
        info: sessionInfo({ id: 'ses-b' }),
        messages: [assistantMessage('Reply B', { completed: true })],
        diff: [],
      },
    })

    const result = await collectFusionSources(client, [
      entry({ id: 1, model: 'openai/a', sessionId: 'ses-a' }),
      entry({ id: 2, model: 'openai/b', sessionId: 'ses-b' }),
    ])

    expect(result.ready.map((source) => source.entryId)).toEqual([1, 2])
    expect(sessionActive).toHaveBeenCalledTimes(1)
  })

  it('classifies every started source as unavailable when the active-session read fails', async () => {
    const { client, sessionActive } = createFakeClient({
      'ses-a': { info: sessionInfo({ id: 'ses-a' }), activeError: new Error('active boom') },
      'ses-b': { info: sessionInfo({ id: 'ses-b' }), activeError: new Error('active boom') },
    })

    const result = await collectFusionSources(client, [
      entry({ id: 1, model: 'openai/a', sessionId: 'ses-a' }),
      entry({ id: 2, model: 'openai/b', sessionId: 'ses-b' }),
    ])

    expect(result.ready).toEqual([])
    expect(result.unavailable).toEqual([
      { entryId: 1, model: 'openai/a', reason: 'unavailable', message: 'active boom' },
      { entryId: 2, model: 'openai/b', reason: 'unavailable', message: 'active boom' },
    ])
    expect(sessionActive).toHaveBeenCalledTimes(1)
  })

  it('only calls read endpoints and never writes to source sessions', async () => {
    const { client, sessionPrompt, sessionCreate, sessionInterrupt } = createFakeClient({
      'ses-1': {
        info: sessionInfo({ id: 'ses-1' }),
        messages: [assistantMessage('Done', { completed: true })],
        firstUser: userMessage('msg-first'),
        lastUser: userMessage('msg-last'),
        diff: [],
      },
    })

    await collectFusionSources(client, [entry()])

    expect(sessionPrompt).not.toHaveBeenCalled()
    expect(sessionCreate).not.toHaveBeenCalled()
    expect(sessionInterrupt).not.toHaveBeenCalled()
  })
})

describe('buildFusionPrompt', () => {
  it('includes the objective, instructions and every source with untruncated content', () => {
    const result = buildFusionPrompt({
      runName: 'Refactor auth',
      objective: 'Refactor the authentication flow.',
      instructions: 'Prefer the smallest possible change.',
      sources: [
        fusionSource({
          entryId: 1,
          model: 'openai/a',
          sessionId: 'ses-a',
          replyText: 'Reply from A',
          changes: [fileDiff('src/a.ts', '@@ -1 +1 @@\n-old\n+new')],
        }),
        fusionSource({
          entryId: 2,
          model: 'anthropic/b',
          sessionId: 'ses-b',
          replyText: 'Reply from B',
          changes: [fileDiff('src/b.ts', '@@ -2 +2 @@\n-x\n+y')],
        }),
      ],
    })

    expect(result.prompt).toContain('Refactor the authentication flow.')
    expect(result.prompt).toContain('Prefer the smallest possible change.')
    expect(result.prompt).toContain('## Source 1 — openai/a')
    expect(result.prompt).toContain('## Source 2 — anthropic/b')
    expect(result.prompt).toContain('ses-a')
    expect(result.prompt).toContain('ses-b')
    expect(result.prompt).toContain('Reply from A')
    expect(result.prompt).toContain('Reply from B')
    expect(result.prompt).toContain('@@ -1 +1 @@')
    expect(result.prompt).toContain('@@ -2 +2 @@')
    expect(result.prompt).toContain('src/a.ts (modified, +1/-1)')
    expect(result.prompt).not.toContain(SESSION_REPLY_TRUNCATION_MARKER)
    expect(result.prompt.length).toBeLessThanOrEqual(FUSION_PROMPT_MAX_LENGTH)
    expect(result.sources).toEqual([
      { entryId: 1, sessionId: 'ses-a', model: 'openai/a', truncated: false },
      { entryId: 2, sessionId: 'ses-b', model: 'anthropic/b', truncated: false },
    ])
  })

  it('omits the additional instructions section when none are given', () => {
    const result = buildFusionPrompt({
      runName: 'Run',
      objective: 'Objective.',
      sources: [
        fusionSource({ entryId: 1 }),
        fusionSource({ entryId: 2, model: 'openai/b', sessionId: 'ses-b' }),
      ],
    })

    expect(result.prompt).not.toContain('## Additional instructions')
    expect(result.prompt).toContain('## Rules')
  })

  it('truncates oversized replies and diffs, flags the source and stays within the limit', () => {
    const result = buildFusionPrompt({
      runName: 'Large',
      objective: 'Synthesize the results.',
      sources: [
        fusionSource({
          entryId: 1,
          model: 'openai/a',
          sessionId: 'ses-a',
          replyText: 'r'.repeat(100_000),
          changes: [],
        }),
        fusionSource({
          entryId: 2,
          model: 'openai/b',
          sessionId: 'ses-b',
          replyText: 'short reply',
          changes: [fileDiff('src/b.ts', `@@ -1 +1 @@\n${'p'.repeat(200_000)}`)],
        }),
        fusionSource({ entryId: 3, model: 'openai/c', sessionId: 'ses-c', replyText: 'small reply', changes: [] }),
      ],
    })

    expect(result.sources).toEqual([
      { entryId: 1, sessionId: 'ses-a', model: 'openai/a', truncated: true },
      { entryId: 2, sessionId: 'ses-b', model: 'openai/b', truncated: true },
      { entryId: 3, sessionId: 'ses-c', model: 'openai/c', truncated: false },
    ])
    expect(result.prompt).toContain(SESSION_REPLY_TRUNCATION_MARKER)
    expect(result.prompt.length).toBeLessThanOrEqual(FUSION_PROMPT_MAX_LENGTH)
  })

  it('renders a changes-could-not-be-read line when the diff is unavailable', () => {
    const result = buildFusionPrompt({
      runName: 'Run',
      objective: 'Objective.',
      sources: [
        fusionSource({ entryId: 1, changes: null }),
        fusionSource({ entryId: 2, model: 'openai/b', sessionId: 'ses-b' }),
      ],
    })

    expect(result.prompt).toContain('Changes could not be read.')
    expect(result.sources[0]?.truncated).toBe(false)
  })

  it('returns only the preamble when there are no sources', () => {
    const result = buildFusionPrompt({ runName: 'Run', objective: 'Objective.', sources: [] })

    expect(result.sources).toEqual([])
    expect(result.prompt).toContain('## Original objective')
    expect(result.prompt).not.toContain('## Source')
  })

  it('throws FusionContextLimitError when the fixed sections leave too little room per source', () => {
    let error: unknown
    try {
      buildFusionPrompt({
        runName: 'Oversized',
        objective: 'o'.repeat(55_000),
        instructions: 'i'.repeat(4_000),
        sources: [
          fusionSource({ entryId: 1 }),
          fusionSource({ entryId: 2, model: 'openai/b', sessionId: 'ses-b' }),
        ],
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(FusionContextLimitError)
    const limitError = error as FusionContextLimitError
    expect(limitError.status).toBe(413)
    expect(limitError.code).toBe('FUSION_CONTEXT_LIMIT')
    expect(limitError.details).toEqual({
      requiredPerSource: FUSION_MIN_SOURCE_CONTEXT,
      availablePerSource: expect.any(Number),
    })
  })
})
