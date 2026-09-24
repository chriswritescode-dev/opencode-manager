import { describe, expect, it } from 'vitest'
import type { SessionMessageAssistant, V2Event } from '@opencode-manager/shared/opencode'
import {
  applySessionEvent,
  emptySessionTranscript,
  hydrateSessionTranscript,
  mergeNewestPage,
  sessionEventRequiresResync,
  type SessionTranscript,
} from './applySessionEvent'
import {
  ASSISTANT_MESSAGE_ID,
  SESSION_ID,
  SHELL_ID,
  TOOL_ID,
  USER_INBOX_ID,
  compactionSequence,
  eventID,
  executionSequence,
  failedCompactionSequence,
  failedToolSequence,
  instructionsSequence,
  messageID,
  promptSequence,
  queuedPromptSequence,
  revertCommitSequence,
  revertSequence,
  shellSequence,
  statusSequence,
  syntheticSequence,
  textStreamSequence,
} from './fixtures'

function applyAll(events: V2Event[]): SessionTranscript {
  return events.reduce(applySessionEvent, emptySessionTranscript)
}

function assistantMessage(transcript: SessionTranscript): SessionMessageAssistant {
  const message = transcript.messages.at(-1)
  if (message?.type !== 'assistant') throw new Error('expected an assistant message')
  return message
}

function contentPart<Type extends 'text' | 'reasoning' | 'tool'>(
  transcript: SessionTranscript,
  type: Type,
): Extract<SessionMessageAssistant['content'][number], { type: Type }> {
  const part = assistantMessage(transcript).content.find((entry) => entry.type === type)
  if (part?.type !== type) throw new Error(`expected a ${type} part`)
  return part
}

describe('applySessionEvent', () => {
  it('projects a prompt lifecycle into one user message and one assistant message', () => {
    const transcript = applyAll(promptSequence)

    expect(transcript.messages.map((message) => message.type)).toEqual(['user', 'assistant'])
    expect(transcript.messages[0]).toMatchObject({
      id: USER_INBOX_ID,
      type: 'user',
      text: 'Run the tests',
      time: { created: 1010 },
    })
    expect(assistantMessage(transcript).content).toEqual([
      { type: 'text', text: 'Running the tests now.' },
      { type: 'reasoning', text: 'Checking the suite first.', time: { created: 1050, completed: 1060 } },
      {
        type: 'tool',
        id: TOOL_ID,
        name: 'shell',
        executed: true,
        time: { created: 1070, ran: 1080, completed: 1090 },
        state: {
          status: 'completed',
          input: { command: 'bun test' },
          content: [{ type: 'text', text: '12 tests passed' }],
          metadata: { exit: 0 },
        },
      },
    ])
    expect(transcript.pending).toEqual([])
  })

  it('materializes an enqueued prompt and clears it from pending on delivery', () => {
    const enqueued = applySessionEvent(emptySessionTranscript, promptSequence[0])

    expect(enqueued.pending).toHaveLength(1)
    expect(enqueued.messages).toMatchObject([
      { id: USER_INBOX_ID, type: 'user', text: 'Run the tests', time: { created: 1000 } },
    ])

    const delivered = applySessionEvent(enqueued, promptSequence[1])

    expect(delivered.pending).toEqual([])
    expect(delivered.messages).toMatchObject([
      { id: USER_INBOX_ID, type: 'user', text: 'Run the tests', time: { created: 1010 } },
    ])
  })

  it('updates the delivery mode of a pending prompt', () => {
    const queued = applySessionEvent(emptySessionTranscript, queuedPromptSequence[0])

    expect(queued.pending[0]?.delivery).toBe('queue')

    const changed = applySessionEvent(queued, queuedPromptSequence[1])

    expect(changed.pending[0]?.delivery).toBe('steer')
  })

  it('retracts a cancelled prompt from pending and from the transcript', () => {
    const queued = applySessionEvent(emptySessionTranscript, queuedPromptSequence[0])
    const changed = applySessionEvent(queued, queuedPromptSequence[1])
    const cancelled = applySessionEvent(changed, queuedPromptSequence[2])

    expect(cancelled.pending).toEqual([])
    expect(cancelled.messages).toEqual([])
  })

  it('appends streamed text deltas', () => {
    const started = applyAll(textStreamSequence.slice(0, 2))
    const firstDelta = applySessionEvent(started, textStreamSequence[2])

    expect(contentPart(firstDelta, 'text').text).toBe('Hello ')

    const secondDelta = applySessionEvent(firstDelta, textStreamSequence[3])

    expect(contentPart(secondDelta, 'text').text).toBe('Hello world')
  })

  it('replaces accumulated text with the final text when the part ends', () => {
    const started = applyAll(textStreamSequence.slice(0, 2))
    const missedDelta = applySessionEvent(started, textStreamSequence[3])

    expect(contentPart(missedDelta, 'text').text).toBe('world')

    const ended = applySessionEvent(missedDelta, textStreamSequence[4])

    expect(contentPart(ended, 'text').text).toBe('Hello world')
  })

  it('accumulates reasoning deltas and replaces them with the final reasoning', () => {
    const started = applyAll(promptSequence.slice(0, 8))
    const firstDelta = applySessionEvent(started, promptSequence[8])

    expect(contentPart(firstDelta, 'reasoning').text).toBe('Checking ')

    const secondDelta = applySessionEvent(firstDelta, promptSequence[9])
    const ended = applySessionEvent(secondDelta, promptSequence[10])

    expect(contentPart(ended, 'reasoning')).toEqual({
      type: 'reasoning',
      text: 'Checking the suite first.',
      time: { created: 1050, completed: 1060 },
    })
  })

  it('records a tool lifecycle that completes with input, content, and metadata', () => {
    const transcript = applyAll(promptSequence.slice(2))

    expect(contentPart(transcript, 'tool')).toEqual({
      type: 'tool',
      id: TOOL_ID,
      name: 'shell',
      executed: true,
      time: { created: 1070, ran: 1080, completed: 1090 },
      state: {
        status: 'completed',
        input: { command: 'bun test' },
        content: [{ type: 'text', text: '12 tests passed' }],
        metadata: { exit: 0 },
      },
    })
  })

  it('records a failed tool with its error and metadata', () => {
    const transcript = applyAll(failedToolSequence)

    expect(contentPart(transcript, 'tool')).toEqual({
      type: 'tool',
      id: TOOL_ID,
      name: 'shell',
      executed: true,
      time: { created: 3010, ran: 3020, completed: 3030 },
      state: {
        status: 'error',
        input: { command: 'bun test' },
        error: { type: 'tool.failed', message: 'command exited 1' },
        metadata: { exit: 1 },
      },
    })
  })

  it('projects a shell command message from start to exit', () => {
    const started = applySessionEvent(emptySessionTranscript, shellSequence[0])

    expect(started.messages).toMatchObject([
      {
        id: messageID(40),
        type: 'shell',
        shellID: SHELL_ID,
        command: 'bun test',
        status: 'running',
        time: { created: 4000 },
      },
    ])

    const ended = applySessionEvent(started, shellSequence[1])

    expect(ended.messages).toMatchObject([
      {
        id: messageID(40),
        type: 'shell',
        shellID: SHELL_ID,
        command: 'bun test',
        status: 'exited',
        exit: 0,
        output: { output: '12 tests passed', cursor: 0, size: 16, truncated: false },
        time: { created: 4000, completed: 4050 },
      },
    ])
  })

  it('projects a running compaction that completes with its summary', () => {
    const started = applySessionEvent(emptySessionTranscript, compactionSequence[0])
    const delta = applySessionEvent(started, compactionSequence[1])

    expect(delta.messages).toMatchObject([
      {
        id: messageID(50),
        type: 'compaction',
        status: 'running',
        summary: 'Summarizing',
        recent: 'previous turn',
      },
    ])

    const ended = applySessionEvent(delta, compactionSequence[2])

    expect(ended.messages).toMatchObject([
      {
        id: messageID(50),
        type: 'compaction',
        status: 'completed',
        summary: 'Summarizing the previous turn.',
        recent: 'previous turn',
        reason: 'auto',
        cost: 0.02,
        tokens: { input: 900, output: 60, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 5000 },
      },
    ])
  })

  it('records a failed compaction with its error', () => {
    const transcript = applyAll(failedCompactionSequence)

    expect(transcript.messages).toMatchObject([
      {
        id: messageID(53),
        type: 'compaction',
        status: 'failed',
        reason: 'manual',
        error: { type: 'compaction.failed', message: 'provider unavailable' },
        time: { created: 5030 },
      },
    ])
  })

  it('re-applies a completed compaction to the message it already ended', () => {
    const completed = applyAll(compactionSequence)
    const reapplied = compactionSequence.reduce(applySessionEvent, completed)

    expect(reapplied.messages).toHaveLength(1)
    expect(reapplied.messages).toMatchObject([
      {
        id: messageID(50),
        type: 'compaction',
        status: 'completed',
        summary: 'Summarizing the previous turn.',
      },
    ])
  })

  it('re-applies a failed compaction to the message it already failed', () => {
    const failed = applyAll(failedCompactionSequence)
    const reapplied = failedCompactionSequence.reduce(applySessionEvent, failed)

    expect(reapplied.messages).toHaveLength(1)
    expect(reapplied.messages).toMatchObject([
      {
        id: messageID(53),
        type: 'compaction',
        status: 'failed',
        error: { type: 'compaction.failed', message: 'provider unavailable' },
      },
    ])
  })

  it('ends only the running compaction and appends when none is running', () => {
    const failed = applyAll(failedCompactionSequence)
    const ended = applySessionEvent(failed, compactionSequence[2] as V2Event)

    expect(ended.messages).toHaveLength(2)
    expect(ended.messages).toMatchObject([
      { id: messageID(53), type: 'compaction', status: 'failed' },
      {
        id: messageID(52),
        type: 'compaction',
        status: 'completed',
        summary: 'Summarizing the previous turn.',
      },
    ])
  })

  it('does not duplicate a re-applied synthetic message', () => {
    const once = applySessionEvent(emptySessionTranscript, syntheticSequence[0])

    expect(once.messages).toHaveLength(1)

    const reapplied = applySessionEvent(once, syntheticSequence[0])

    expect(reapplied).toBe(once)
    expect(reapplied.messages).toHaveLength(1)
  })

  it('does not duplicate a re-applied idle marker', () => {
    const once = applyAll(executionSequence)

    expect(once.messages).toHaveLength(1)

    const reapplied = applySessionEvent(once, executionSequence[1])

    expect(reapplied).toBe(once)
    expect(reapplied.messages).toHaveLength(1)
  })

  it('ignores staged and cleared reverts while truncating a committed revert', () => {
    const staged = applyAll(revertSequence)

    expect(staged.messages.map((message) => message.id)).toEqual([ASSISTANT_MESSAGE_ID])
    expect(applySessionEvent(staged, revertSequence[1])).toBe(staged)

    const cleared = applySessionEvent(staged, revertSequence[2])

    expect(cleared).toBe(staged)

    const committed = applyAll(revertCommitSequence)

    expect(committed.messages.map((message) => message.id)).toEqual([USER_INBOX_ID])
  })

  it('tracks busy and idle session status', () => {
    const busy = applySessionEvent(emptySessionTranscript, statusSequence[0])

    expect(busy.status).toBe('busy')

    const idle = applySessionEvent(busy, statusSequence[2])

    expect(idle.status).toBe('idle')
    expect(idle.retry).toBeUndefined()
  })

  it('records the retry status while the session retries', () => {
    const busy = applySessionEvent(emptySessionTranscript, statusSequence[0])
    const retry = applySessionEvent(busy, statusSequence[1])

    expect(retry.status).toBe('retry')
    expect(retry.retry).toEqual({ type: 'retry', attempt: 2, message: 'rate limited', next: 8020 })
  })

  it('marks the session busy while executing and appends an idle marker when it ends', () => {
    const started = applySessionEvent(emptySessionTranscript, executionSequence[0])

    expect(started.status).toBe('busy')
    expect(started.messages).toEqual([])

    const succeeded = applySessionEvent(started, executionSequence[1])

    expect(succeeded.status).toBe('idle')
    expect(succeeded.messages).toMatchObject([
      { id: messageID(91), type: 'idle', outcome: 'succeeded', time: { created: 9010 } },
    ])
  })

  it('records the failed outcome when execution fails', () => {
    const started = applySessionEvent(emptySessionTranscript, executionSequence[0])
    const failed = applySessionEvent(started, {
      id: eventID(93),
      created: 9030,
      type: 'session.execution.failed',
      durable: { aggregateID: SESSION_ID, seq: 93, version: 1 },
      data: { sessionID: SESSION_ID, error: { type: 'execution.failed', message: 'boom' } },
    })

    expect(failed.status).toBe('idle')
    expect(failed.messages).toMatchObject([
      { id: messageID(93), type: 'idle', outcome: 'failed', time: { created: 9030 } },
    ])
  })

  it('keeps the transcript idle without a marker when shutdown interrupts execution', () => {
    const started = applySessionEvent(emptySessionTranscript, executionSequence[0])
    const interrupted = applySessionEvent(started, {
      id: eventID(94),
      created: 9040,
      type: 'session.execution.interrupted',
      durable: { aggregateID: SESSION_ID, seq: 94, version: 1 },
      data: { sessionID: SESSION_ID, reason: 'shutdown' },
    })

    expect(interrupted.status).toBe('idle')
    expect(interrupted.messages).toEqual([])
  })

  it('records agent, model, and location switches as transcript messages', () => {
    const agentSelected = applySessionEvent(emptySessionTranscript, {
      id: eventID(140),
      created: 14000,
      type: 'session.agent.selected',
      durable: { aggregateID: 'ses_1', seq: 140, version: 1 },
      data: { sessionID: 'ses_1', agent: 'plan', previous: 'build' },
    })

    expect(agentSelected.messages).toMatchObject([
      {
        id: messageID(140),
        type: 'agent-switched',
        agent: 'plan',
        previous: 'build',
        time: { created: 14000 },
      },
    ])

    const modelSelected = applySessionEvent(agentSelected, {
      id: eventID(141),
      created: 14010,
      type: 'session.model.selected',
      durable: { aggregateID: 'ses_1', seq: 141, version: 1 },
      data: {
        sessionID: 'ses_1',
        model: { id: 'gpt-5', providerID: 'openai' },
        previous: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      },
    })

    expect(modelSelected.messages).toMatchObject([
      { type: 'agent-switched' },
      {
        id: messageID(141),
        type: 'model-switched',
        model: { id: 'gpt-5', providerID: 'openai' },
        previous: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
        time: { created: 14010 },
      },
    ])

    const moved = applySessionEvent(modelSelected, {
      id: eventID(142),
      created: 14020,
      type: 'session.moved',
      durable: { aggregateID: 'ses_1', seq: 142, version: 1 },
      data: { sessionID: 'ses_1', location: { directory: '/repo' }, projectID: 'proj_1' },
    })

    expect(moved.messages).toMatchObject([
      { type: 'agent-switched' },
      { type: 'model-switched' },
      {
        id: messageID(142),
        type: 'location-switched',
        location: { directory: '/repo' },
        projectID: 'proj_1',
        time: { created: 14020 },
      },
    ])
  })

  it('records scheduled retries on the active assistant message', () => {
    const started = applyAll(textStreamSequence.slice(0, 1))
    const retried = applySessionEvent(started, {
      id: eventID(150),
      created: 15000,
      type: 'session.retry.scheduled',
      durable: { aggregateID: 'ses_1', seq: 150, version: 1 },
      data: {
        sessionID: 'ses_1',
        assistantMessageID: ASSISTANT_MESSAGE_ID,
        attempt: 3,
        at: 15010,
        error: { type: 'retry', message: 'rate limited' },
      },
    })

    expect(assistantMessage(retried).retry).toEqual({
      attempt: 3,
      at: 15010,
      error: { type: 'retry', message: 'rate limited' },
    })
  })

  it('records synthetic messages and instructions updates as muted notices', () => {
    const synthetic = applySessionEvent(emptySessionTranscript, syntheticSequence[0])

    expect(synthetic.messages).toMatchObject([
      {
        id: messageID(120),
        type: 'synthetic',
        text: 'Continue from the summary.',
        description: 'Synthetic',
        time: { created: 12000 },
      },
    ])

    const instructions = applySessionEvent(synthetic, instructionsSequence[0])

    expect(instructions.messages).toMatchObject([
      { type: 'synthetic' },
      {
        id: messageID(110),
        type: 'system',
        text: 'Instructions changed.',
        description: 'Instructions updated: AGENTS.md',
        time: { created: 11000 },
      },
    ])
  })

  it('ignores unknown events and events that do not apply', () => {
    const transcript = applyAll(promptSequence)

    expect(
      applySessionEvent(transcript, {
        id: eventID(160),
        created: 16000,
        type: 'config.updated',
        data: {},
      }),
    ).toBe(transcript)

    expect(
      applySessionEvent(transcript, {
        id: eventID(161),
        created: 16010,
        type: 'session.text.delta',
        data: { sessionID: 'ses_1', assistantMessageID: 'msg_missing', ordinal: 0, delta: 'late' },
      }),
    ).toBe(transcript)
  })
})

describe('sessionEventRequiresResync', () => {
  const executionEnded = executionSequence[1] as V2Event

  it('requires a resync when execution ends while a tool is still running', () => {
    const transcript = applyAll(promptSequence.slice(0, 15))

    expect(sessionEventRequiresResync(applySessionEvent(transcript, executionEnded), executionEnded)).toBe(true)
  })

  it('requires a resync when execution ends before the active assistant completes', () => {
    const transcript = applyAll(promptSequence.slice(0, 7))

    expect(sessionEventRequiresResync(applySessionEvent(transcript, executionEnded), executionEnded)).toBe(true)
  })

  it('does not require a resync when execution ends on a settled transcript', () => {
    const transcript = applyAll(promptSequence)

    expect(sessionEventRequiresResync(applySessionEvent(transcript, executionEnded), executionEnded)).toBe(false)
  })

  it('does not require a resync for events other than execution end', () => {
    const transcript = applyAll(promptSequence.slice(0, 15))

    expect(sessionEventRequiresResync(transcript, promptSequence[14] as V2Event)).toBe(false)
  })
})

describe('mergeNewestPage', () => {
  const older = { id: messageID(0), type: 'synthetic' as const, text: 'Earlier', time: { created: 900 } }
  const user = { id: USER_INBOX_ID, type: 'user' as const, text: 'Run the tests', time: { created: 1000 } }
  const newer = { id: messageID(300), type: 'synthetic' as const, text: 'Later', time: { created: 30000 } }

  it('keeps older loaded messages and the older cursor when the newest page overlaps', () => {
    const merged = mergeNewestPage(
      { transcript: { ...emptySessionTranscript, messages: [older, user] }, nextCursor: 'cursor_0' },
      { messages: [user, newer], pending: [], status: 'idle', nextCursor: 'cursor_1' },
    )

    expect(merged.nextCursor).toBe('cursor_0')
    expect(merged.transcript.messages.map((message) => message.id)).toEqual([
      older.id,
      user.id,
      newer.id,
    ])
  })

  it('replaces the cache when the newest page leaves a gap', () => {
    const merged = mergeNewestPage(
      { transcript: { ...emptySessionTranscript, messages: [older, user] }, nextCursor: 'cursor_0' },
      { messages: [newer], pending: [], status: 'idle', nextCursor: 'cursor_1' },
    )

    expect(merged.nextCursor).toBe('cursor_1')
    expect(merged.transcript.messages).toEqual([newer])
  })

  it('replaces the cache when the newest page holds the whole history', () => {
    const merged = mergeNewestPage(
      { transcript: { ...emptySessionTranscript, messages: [older, user] }, nextCursor: 'cursor_0' },
      { messages: [user, newer], pending: [], status: 'busy' },
    )

    expect(merged.nextCursor).toBeUndefined()
    expect(merged.transcript.messages).toEqual([user, newer])
    expect(merged.transcript.status).toBe('busy')
  })
})

describe('hydrateSessionTranscript', () => {
  it('seeds messages, pending prompts, and execution status from a snapshot', () => {
    const pending = {
      id: messageID(200),
      sessionID: SESSION_ID,
      time: { created: 20000 },
      type: 'user' as const,
      payload: { text: 'Wait for me' },
      delivery: 'queue' as const,
    }
    const transcript = hydrateSessionTranscript({
      messages: [
        { id: USER_INBOX_ID, type: 'user', text: 'Run the tests', time: { created: 1000 } },
      ],
      pending: [pending],
      status: 'busy',
    })

    expect(transcript.status).toBe('busy')
    expect(transcript.pending).toEqual([pending])
    expect(transcript.messages).toMatchObject([
      { id: USER_INBOX_ID, type: 'user', text: 'Run the tests', time: { created: 1000 } },
      {
        id: messageID(200),
        type: 'user',
        text: 'Wait for me',
        time: { created: 20000 },
      },
    ])
  })
})
